'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Report } = require('../../src/modules/moderation/report.model');
const { ModerationAction } = require('../../src/modules/moderation/moderation-action.model');
const { logger } = require('../../src/config/logger');
const { RESTRICT_AFTER_WARNINGS } = require('../../src/modules/moderation/moderation.service');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 14 gate (plan step 89): progressive enforcement
 * warning count → restriction → ban → identity_revealed.
 * - Warnings auto-restrict at the threshold (semi-automated ladder).
 * - Restricted accounts keep read access, lose content creation (403).
 * - Bans hard-stop the next authenticated request (loadUser 403).
 * - identity_revealed is rejected without explicit confirmation and writes
 *   its OWN audit entry: an append-only ModerationAction row + a dedicated
 *   structured log line (§7.2).
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(displayName = 'User', role) {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName,
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  const data = res.body.data;
  if (role) {
    await User.updateOne({ _id: data.user.id }, { $set: { 'roles.security': role } });
  }
  return data;
}

function act(modToken, body) {
  return request(app)
    .post('/api/v1/moderation/actions')
    .set('Authorization', `Bearer ${modToken}`)
    .send(body);
}

async function moderationOf(userId) {
  const doc = await User.findById(userId).select('moderation').lean();
  return doc.moderation;
}

async function createPublishedPoem(token) {
  const create = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Witness', content: 'a line\na second line', visibility: 'public' });
  expect(create.status).toBe(201);
  const pub = await request(app)
    .post(`/api/v1/poems/${create.body.data.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(pub.status).toBe(200);
  return pub.body.data;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Poem, PoemVersion, Report, ModerationAction]);
});

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('progressive enforcement', () => {
  it('accumulates warnings and auto-restricts at the threshold', async () => {
    const mod = await register('LadderMod', 'moderator');
    const target = await register('LadderTarget');

    const first = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'warning',
      reason: 'first warning: spammy comments',
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      action: { actionType: 'warning' },
      warningCount: 1,
      moderationStatus: 'active',
      escalatedTo: null,
    });

    await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'warning',
      reason: 'second warning',
    });
    let modState = await moderationOf(target.user.id);
    expect(modState.warningCount).toBe(2);
    expect(modState.status).toBe('active');

    const third = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'warning',
      reason: 'third warning',
    });
    expect(third.status).toBe(201);
    expect(third.body.data.escalatedTo).toBe('restricted');
    expect(third.body.data.warningCount).toBe(RESTRICT_AFTER_WARNINGS);
    modState = await moderationOf(target.user.id);
    expect(modState.status).toBe('restricted');
    expect(modState.warningCount).toBe(RESTRICT_AFTER_WARNINGS);

    const actions = await ModerationAction.find({ userId: target.user.id }).lean();
    expect(actions.map((a) => a.actionType)).toEqual(['warning', 'warning', 'warning']);
  });

  it('lets restricted accounts read but blocks content creation with 403', async () => {
    const mod = await register('GuardMod', 'moderator');
    const author = await register('GuardAuthor');
    const target = await register('GuardTarget');
    const poem = await createPublishedPoem(author.accessToken);

    await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'restriction',
      reason: 'repeated policy violations',
    });

    const poemCreate = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({ title: 'Nope', content: 'blocked', visibility: 'public' });
    expect(poemCreate.status).toBe(403);
    expect(poemCreate.body.error.code).toBe('ACCOUNT_RESTRICTED');

    const comment = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({ targetType: 'poem', targetId: poem.id, content: 'also blocked' });
    expect(comment.status).toBe(403);
    expect(comment.body.error.code).toBe('ACCOUNT_RESTRICTED');

    const story = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${target.accessToken}`)
      .send({ title: 'Blocked tale' });
    expect(story.status).toBe(403);

    // Reads keep working (§7.1: restriction is not a ban).
    const read = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${target.accessToken}`);
    expect(read.status).toBe(200);
  });

  it('ban stops the next authenticated request outright', async () => {
    const mod = await register('BanMod', 'moderator');
    const target = await register('BanTarget');

    const ban = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'ban',
      reason: 'severe harassment',
    });
    expect(ban.status).toBe(201);
    expect(ban.body.data.moderationStatus).toBe('banned');

    const blocked = await request(app)
      .get('/api/v1/poems/mine')
      .set('Authorization', `Bearer ${target.accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_BANNED');
    expect((await moderationOf(target.user.id)).status).toBe('banned');
  });

  it('never downgrades a ban with a later restriction', async () => {
    const mod = await register('NoDowngradeMod', 'moderator');
    const target = await register('NoDowngradeTarget');

    await act(mod.accessToken, { userId: target.user.id, actionType: 'ban', reason: 'banned' });
    const res = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'restriction',
      reason: 'would otherwise downgrade',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.moderationStatus).toBe('banned');
    expect((await moderationOf(target.user.id)).status).toBe('banned');
  });
});

describe('identity_revealed (plan step 89 audit gate)', () => {
  let infoSpy;
  beforeAll(() => {
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
  });
  afterAll(() => {
    infoSpy.mockRestore();
  });

  it('requires explicit confirmation and writes its own audit entry', async () => {
    const mod = await register('IdentityMod', 'moderator');
    const reporter = await register('IdentityReporter');
    const author = await register('IdentityAuthor');
    const target = await register('IdentityTarget');
    const poem = await createPublishedPoem(author.accessToken);

    const reportRes = await request(app)
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${reporter.accessToken}`)
      .send({ targetType: 'poem', targetId: poem.id, reason: 'harassment' });
    expect(reportRes.status).toBe(201);
    const reportId = reportRes.body.data.id;

    infoSpy.mockClear();

    // 1) Without confirmIdentity: clean 400, nothing written anywhere.
    const refused = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'identity_revealed',
      reason: 'unmask anonymous harasser',
      reportId,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('IDENTITY_CONFIRMATION_REQUIRED');
    expect(await ModerationAction.countDocuments({ userId: target.user.id })).toBe(0);
    expect((await moderationOf(target.user.id)).isAnonymizedAccount).toBe(false);
    expect(infoSpy.mock.calls.some(([p]) => p?.event === 'moderation:identity_revealed')).toBe(
      false,
    );

    // 2) With confirmIdentity: effect + the dedicated audit trail.
    const revealed = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'identity_revealed',
      reason: 'unmask anonymous harasser',
      reportId,
      confirmIdentity: true,
    });
    expect(revealed.status).toBe(201);
    expect(revealed.body.data.action).toMatchObject({
      actionType: 'identity_revealed',
      userId: target.user.id,
      moderatorId: mod.user.id,
      reportId,
      reason: 'unmask anonymous harasser',
    });

    // Audit entry 1: the append-only ModerationAction row.
    const auditRows = await ModerationAction.find({ userId: target.user.id }).lean();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actionType: 'identity_revealed',
      reportId: expect.anything(),
      reason: 'unmask anonymous harasser',
    });
    expect(String(auditRows[0].moderatorId)).toBe(mod.user.id);
    expect(String(auditRows[0].reportId)).toBe(reportId);

    // Audit entry 2: the dedicated structured log line (§7.2).
    const auditLog = infoSpy.mock.calls.find(([p]) => p?.event === 'moderation:identity_revealed');
    expect(auditLog).toBeTruthy();
    expect(auditLog[0]).toMatchObject({
      targetUserId: target.user.id,
      moderatorId: mod.user.id,
      reportId,
    });

    // Account marker set, linked report closed out.
    expect((await moderationOf(target.user.id)).isAnonymizedAccount).toBe(true);
    const linkedReport = await Report.findById(reportId).lean();
    expect(linkedReport.status).toBe('actioned');
  });
});

describe('action authorization', () => {
  it('blocks non-moderators, self-actions, and unknown targets', async () => {
    const plain = await register('PlainUser');
    const mod = await register('AuthMod', 'moderator');
    const other = await register('AuthOther');

    const asPlain = await act(plain.accessToken, {
      userId: other.user.id,
      actionType: 'warning',
      reason: 'i am not a mod',
    });
    expect(asPlain.status).toBe(403);
    expect(asPlain.body.error.code).toBe('NOT_MODERATOR');

    const self = await act(mod.accessToken, {
      userId: mod.user.id,
      actionType: 'warning',
      reason: 'to myself',
    });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_ACTION_SELF');

    const ghost = await act(mod.accessToken, {
      userId: '64b000000000000000000000',
      actionType: 'warning',
      reason: 'no one home',
    });
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('only an admin may action staff accounts', async () => {
    const mod = await register('StaffMod', 'moderator');
    const admin = await register('StaffAdmin', 'admin');
    const otherMod = await register('VictimMod', 'moderator');

    const byMod = await act(mod.accessToken, {
      userId: otherMod.user.id,
      actionType: 'warning',
      reason: 'peer action attempt',
    });
    expect(byMod.status).toBe(403);
    expect(byMod.body.error.code).toBe('FORBIDDEN');

    const byAdmin = await act(admin.accessToken, {
      userId: otherMod.user.id,
      actionType: 'warning',
      reason: 'admin action',
    });
    expect(byAdmin.status).toBe(201);
    expect((await moderationOf(otherMod.user.id)).warningCount).toBe(1);
  });

  it('404s actions linked to a missing report', async () => {
    const mod = await register('BadReportMod', 'moderator');
    const target = await register('BadReportTarget');

    const res = await act(mod.accessToken, {
      userId: target.user.id,
      actionType: 'warning',
      reason: 'linked report is gone',
      reportId: '64b000000000000000000000',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPORT_NOT_FOUND');
    expect(await ModerationAction.countDocuments({ userId: target.user.id })).toBe(0);
  });
});
