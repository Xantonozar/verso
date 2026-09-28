'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Report } = require('../../src/modules/moderation/report.model');
const { ModerationAction } = require('../../src/modules/moderation/moderation-action.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 14 (plan steps 87 + 90): Report intake + moderator review queue.
 * - Any signed-in user can report viewable content (§5 POST /reports).
 * - One OPEN report per reporter/target (409); dismissed targets re-reportable.
 * - Review queue + triage are moderator-only (403 for regular users).
 * - The reporter's identity is surfaced only to moderators.
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(displayName = 'User') {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName,
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function makeModerator(displayName = 'Mod') {
  const user = await register(displayName);
  await User.updateOne({ _id: user.user.id }, { $set: { 'roles.security': 'moderator' } });
  return user;
}

async function createPoem(token, { visibility = 'public', status = 'published' } = {}) {
  const create = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Open Field', content: 'grass\nand wind', visibility });
  expect(create.status).toBe(201);
  if (status === 'published') {
    const pub = await request(app)
      .post(`/api/v1/poems/${create.body.data.id}/publish`)
      .set('Authorization', `Bearer ${token}`);
    expect(pub.status).toBe(200);
    return pub.body.data;
  }
  return create.body.data;
}

function report(token, body) {
  return request(app).post('/api/v1/reports').set('Authorization', `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Poem, PoemVersion, Report, ModerationAction]);
});

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /reports', () => {
  it('creates a report with the standard envelope and no reporter leak', async () => {
    const author = await register('Author');
    const reporter = await register('Reporter');
    const poem = await createPoem(author.accessToken);

    const res = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'harassment',
      details: 'targeted at the author',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      targetType: 'poem',
      targetId: poem.id,
      reason: 'harassment',
      details: 'targeted at the author',
      status: 'pending',
    });
    expect(res.body.data.id).toBeTruthy();
    // Reporter identity never rides the reporter's own response either —
    // the field simply does not exist on the serializer.
    expect(res.body.data.reporterId).toBeUndefined();
    expect(res.body.data.reporter).toBeUndefined();

    const stored = await Report.findById(res.body.data.id).lean();
    expect(String(stored.reporterId)).toBe(reporter.user.id);
  });

  it('rejects a second open report for the same target with 409', async () => {
    const author = await register('Author');
    const reporter = await register('DupReporter');
    const poem = await createPoem(author.accessToken);

    expect(
      (
        await report(reporter.accessToken, {
          targetType: 'poem',
          targetId: poem.id,
          reason: 'spam',
        })
      ).status,
    ).toBe(201);

    const dup = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'spam',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_REPORT');
  });

  it('allows a fresh report after the first was dismissed', async () => {
    const author = await register('Author');
    const reporter = await register('RetryReporter');
    const mod = await makeModerator('QueueMod');
    const poem = await createPoem(author.accessToken);

    const first = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'other',
    });
    expect(first.status).toBe(201);

    const triage = await request(app)
      .patch(`/api/v1/moderation/reports/${first.body.data.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`)
      .send({ status: 'dismissed' });
    expect(triage.status).toBe(200);

    const second = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'other',
      details: 'adding context after dismissal',
    });
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
  });

  it('rejects reporting yourself as a user target', async () => {
    const reporter = await register('SelfReporter');
    const res = await report(reporter.accessToken, {
      targetType: 'user',
      targetId: reporter.user.id,
      reason: 'harassment',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_REPORT_SELF');
  });

  it('404s for missing targets and for poems the reporter cannot view', async () => {
    const author = await register('DraftAuthor');
    const reporter = await register('NoViewReporter');
    const ghost = '64b000000000000000000000';

    const missing = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: ghost,
      reason: 'spam',
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('REPORT_TARGET_NOT_FOUND');

    // A private draft fails canView → same 404 (existence never leaks, §7.1).
    const draft = await createPoem(author.accessToken, {
      visibility: 'private_draft',
      status: 'draft',
    });
    const hidden = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: draft.id,
      reason: 'spam',
    });
    expect(hidden.status).toBe(404);
  });

  it('validates reason/targetType with field-level 400s', async () => {
    const author = await register('ValidAuthor');
    const reporter = await register('ValidReporter');
    const poem = await createPoem(author.accessToken);

    const res = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'because-i-said-so',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('reason');
  });

  it('401s unauthenticated report attempts', async () => {
    const res = await request(app).post('/api/v1/reports').send({
      targetType: 'poem',
      targetId: '64b000000000000000000000',
      reason: 'spam',
    });
    expect(res.status).toBe(401);
  });
});

describe('moderation review queue', () => {
  it('403s non-moderators on list and triage', async () => {
    const author = await register('QueueAuthor');
    const reporter = await register('QueueReporter');
    const poem = await createPoem(author.accessToken);
    const created = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'spam',
    });

    const list = await request(app)
      .get('/api/v1/moderation/reports')
      .set('Authorization', `Bearer ${reporter.accessToken}`);
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('NOT_MODERATOR');

    const patch = await request(app)
      .patch(`/api/v1/moderation/reports/${created.body.data.id}`)
      .set('Authorization', `Bearer ${reporter.accessToken}`)
      .send({ status: 'reviewed' });
    expect(patch.status).toBe(403);
  });

  it('lists pending reports with reporter identity for moderators', async () => {
    const author = await register('ListAuthor');
    const reporter = await register('ListReporter');
    const mod = await makeModerator('ListMod');
    const poem = await createPoem(author.accessToken);
    await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'hate_speech',
    });

    const res = await request(app)
      .get('/api/v1/moderation/reports?status=pending')
      .set('Authorization', `Bearer ${mod.accessToken}`);
    expect(res.status).toBe(200);
    const mine = res.body.data.items.find((r) => r.targetId === poem.id);
    expect(mine).toBeTruthy();
    expect(mine.reporter).toMatchObject({ id: reporter.user.id });
    expect(mine.reporter.username).toBeTruthy();
    expect(mine.status).toBe('pending');
  });

  it('filters by status and 404s unknown report ids', async () => {
    const author = await register('FilterAuthor');
    const reporter = await register('FilterReporter');
    const mod = await makeModerator('FilterMod');
    const poem = await createPoem(author.accessToken);
    const created = await report(reporter.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      reason: 'other',
    });

    const reviewed = await request(app)
      .patch(`/api/v1/moderation/reports/${created.body.data.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`)
      .send({ status: 'reviewed' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.status).toBe('reviewed');

    const dismissed = await request(app)
      .get('/api/v1/moderation/reports?status=dismissed')
      .set('Authorization', `Bearer ${mod.accessToken}`);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data.items.some((r) => r.id === created.body.data.id)).toBe(false);

    const missing = await request(app)
      .patch('/api/v1/moderation/reports/64b000000000000000000000')
      .set('Authorization', `Bearer ${mod.accessToken}`)
      .send({ status: 'reviewed' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('REPORT_NOT_FOUND');
  });
});
