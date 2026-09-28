'use strict';

const {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} = require('../../errors');
const { isModerator, requireUser } = require('../../middleware/authz');
const { logger } = require('../../config/logger');
const { User } = require('../users/user.model');
const { Poem } = require('../poems/poem.model');
const { Story } = require('../stories/story.model');
const { DiaryEntry } = require('../diary/diary.model');
const { Comment } = require('../engagement/comment.model');
const { canView: poemCanView } = require('../poems/poem.service');
const { Report } = require('./report.model');
const { ModerationAction } = require('./moderation-action.model');

/**
 * Moderation service (Phase 14, plan steps 87-89).
 *
 * Reports are crowd-sourced intake; enforcement is moderator-triggered with a
 * semi-automated escalation ladder (warning count -> restriction -> ban).
 * `identity_revealed` is the most sensitive action in the product: it is
 * rejected without an explicit `confirmIdentity` acknowledgement and writes
 * its own audit entry (append-only ModerationAction row + structured log line)
 * so the disclosure is permanently traceable (§7.2, plan step 89).
 *
 * Identity note: anonymity is a serialization-layer concept (§15) — the data
 * layer always stores real ids, so moderators can already resolve anonymous
 * authors. `identity_revealed` records that a deliberate disclosure decision
 * happened; it never changes what ordinary readers see.
 */

const RESTRICT_AFTER_WARNINGS = 3;

const notFoundReport = () =>
  new NotFoundError('Report not found', { code: 'REPORT_NOT_FOUND' });

function requireModerator(user) {
  requireUser(user);
  if (!isModerator(user)) {
    throw new ForbiddenError('Moderator access required', { code: 'NOT_MODERATOR' });
  }
  return user;
}

function serializeReport(doc, { reporter = null } = {}) {
  const out = {
    id: String(doc._id),
    targetType: doc.targetType,
    targetId: String(doc.targetId),
    reason: doc.reason,
    details: doc.details || '',
    status: doc.status,
    createdAt: doc.createdAt,
  };
  if (reporter) {
    out.reporter = {
      id: String(reporter._id ?? reporter.id),
      username: reporter.username,
      displayName: reporter.displayName,
    };
  }
  return out;
}

function serializeAction(doc) {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    actionType: doc.actionType,
    reason: doc.reason,
    reportId: doc.reportId ? String(doc.reportId) : null,
    moderatorId: String(doc.moderatorId),
    createdAt: doc.createdAt,
  };
}

/** Report targets must exist — and poems must be VIEWABLE by the reporter. */
async function assertTargetReportable(targetType, targetId, requester) {
  const targetNotFound = () =>
    new NotFoundError('Reported content not found', { code: 'REPORT_TARGET_NOT_FOUND' });

  if (targetType === 'poem') {
    const poem = await Poem.findById(targetId).select('authorId status visibility').lean();
    if (!poem || !(await poemCanView(poem, requester))) throw targetNotFound();
    return;
  }
  const modelByType = { story: Story, diary: DiaryEntry, comment: Comment, user: User };
  const exists = await modelByType[targetType].exists({ _id: targetId });
  if (!exists) throw targetNotFound();
}

async function createReport(user, body) {
  requireUser(user);
  if (body.targetType === 'user' && body.targetId === user.id) {
    throw new ValidationError('You cannot report yourself', { code: 'CANNOT_REPORT_SELF' });
  }
  await assertTargetReportable(body.targetType, body.targetId, user);

  const duplicate = await Report.exists({
    reporterId: user.id,
    targetType: body.targetType,
    targetId: body.targetId,
    status: 'pending',
  });
  if (duplicate) {
    throw new ConflictError('You already have an open report for this', {
      code: 'DUPLICATE_REPORT',
    });
  }

  const report = await Report.create({
    reporterId: user.id,
    targetType: body.targetType,
    targetId: body.targetId,
    reason: body.reason,
    details: body.details ?? '',
  });
  logger.info(
    { event: 'report:created', reportId: String(report._id), reporterId: user.id },
    'Report created',
  );
  return serializeReport(report);
}

/** Moderator review queue (plan step 90): pending by default, cursor paged. */
async function listReports(user, query = {}) {
  requireModerator(user);
  const limit = query.limit ?? 20;
  const filter = { status: query.status ?? 'pending' };
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const rows = await Report.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const reporterIds = [...new Set(page.map((r) => String(r.reporterId)))];
  const reporters = reporterIds.length
    ? await User.find({ _id: { $in: reporterIds } })
        .select('username displayName')
        .lean()
    : [];
  const byId = new Map(reporters.map((u) => [String(u._id), u]));

  const last = page[page.length - 1];
  return {
    items: page.map((r) =>
      serializeReport(r, { reporter: byId.get(String(r.reporterId)) ?? null }),
    ),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
  };
}

async function updateReport(user, reportId, { status }) {
  requireModerator(user);
  const report = await Report.findById(reportId).lean();
  if (!report) throw notFoundReport();

  const updated = await Report.findByIdAndUpdate(
    reportId,
    { $set: { status } },
    { new: true },
  ).lean();
  logger.info(
    { event: 'report:updated', reportId, moderatorId: user.id, status },
    'Report status updated',
  );
  return serializeReport(updated);
}

async function loadActionTarget(userId) {
  const target = await User.findById(userId)
    .select('username roles moderation')
    .lean();
  if (!target) {
    throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  }
  return target;
}

function assertActionAllowed(requester, target) {
  if (String(target._id) === String(requester.id)) {
    throw new ValidationError('You cannot apply moderation actions to yourself', {
      code: 'CANNOT_ACTION_SELF',
    });
  }
  const targetIsStaff =
    target.roles?.security === 'moderator' || target.roles?.security === 'admin';
  if (targetIsStaff && requester.role !== 'admin') {
    throw new ForbiddenError('Only an admin can action staff accounts', {
      code: 'FORBIDDEN',
    });
  }
}

async function applyModerationAction(user, body) {
  requireModerator(user);
  const target = await loadActionTarget(body.userId);
  assertActionAllowed(user, target);

  // Explicit confirmation gate for the sensitive action (plan step 89):
  // evaluated BEFORE any effect, so a missing flag is a clean 400 no-op.
  if (body.actionType === 'identity_revealed' && body.confirmIdentity !== true) {
    throw new ValidationError('Identity reveal requires explicit confirmation', {
      code: 'IDENTITY_CONFIRMATION_REQUIRED',
    });
  }

  let report = null;
  if (body.reportId) {
    report = await Report.findById(body.reportId).lean();
    if (!report) throw notFoundReport();
  }

  const before = target.moderation ?? { warningCount: 0, status: 'active' };

  if (body.actionType === 'warning') {
    // Semi-automated ladder: the warning that reaches the threshold promotes
    // an ACTIVE account to restricted in the same atomic pipeline update.
    const nextCount = (before.warningCount ?? 0) + 1;
    await User.updateOne(
      { _id: target._id },
      [
        {
          $set: {
            'moderation.warningCount': {
              $add: [{ $ifNull: ['$moderation.warningCount', 0] }, 1],
            },
            'moderation.status': {
              $cond: [
                {
                  $and: [
                    { $gte: [nextCount, RESTRICT_AFTER_WARNINGS] },
                    { $eq: [{ $ifNull: ['$moderation.status', 'active'] }, 'active'] },
                  ],
                },
                'restricted',
                { $ifNull: ['$moderation.status', 'active'] },
              ],
            },
          },
        },
      ],
      { updatePipeline: true },
    );
  } else if (body.actionType === 'restriction') {
    // Never downgrade a ban — escalation only moves one way.
    if (before.status !== 'banned') {
      await User.updateOne(
        { _id: target._id },
        { $set: { 'moderation.status': 'restricted' } },
      );
    }
  } else if (body.actionType === 'ban') {
    await User.updateOne({ _id: target._id }, { $set: { 'moderation.status': 'banned' } });
  } else {
    // identity_revealed — compliance marker on the account.
    await User.updateOne(
      { _id: target._id },
      { $set: { 'moderation.isAnonymizedAccount': true } },
    );
  }

  const action = await ModerationAction.create({
    userId: target._id,
    actionType: body.actionType,
    reason: body.reason,
    reportId: body.reportId ?? null,
    moderatorId: user.id,
  });

  if (report) {
    await Report.updateOne({ _id: report._id }, { $set: { status: 'actioned' } });
  }

  const after = await User.findById(target._id).select('moderation').lean();
  const result = {
    action: serializeAction(action),
    escalatedTo:
      before.status === 'active' && after.moderation.status === 'restricted'
        ? 'restricted'
        : null,
    warningCount: after.moderation.warningCount,
    moderationStatus: after.moderation.status,
  };

  logger.info(
    {
      event: 'moderation:action',
      actionType: body.actionType,
      actionId: String(action._id),
      targetUserId: String(target._id),
      moderatorId: user.id,
      reportId: body.reportId ?? null,
    },
    'Moderation action applied',
  );
  // Identity disclosure gets its own audit log line (plan step 89) so it is
  // greppable independently of the general action stream.
  if (body.actionType === 'identity_revealed') {
    logger.info(
      {
        event: 'moderation:identity_revealed',
        actionId: String(action._id),
        targetUserId: String(target._id),
        moderatorId: user.id,
        reportId: body.reportId ?? null,
      },
      'Identity revealed (explicit moderator confirmation)',
    );
  }

  return result;
}

module.exports = {
  RESTRICT_AFTER_WARNINGS,
  createReport,
  listReports,
  updateReport,
  applyModerationAction,
};
