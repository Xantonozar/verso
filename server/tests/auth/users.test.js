'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(overrides = {}) {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Profile User',
    email: `${id}@example.com`,
    password: 'Password1',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('auth wiring (§7 step 29) — real User lookups via loadUser', () => {
  test('valid token → GET /users/me returns the REAL user attached by loadUser', async () => {
    const me = await register();
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(me.user.id);
    expect(res.body.data.username).toBe(me.user.username);
    expect(res.body.data.email).toBe(me.user.email);
  });

  test('expired access token → 401 AUTH_TOKEN_EXPIRED', async () => {
    const expired = jwt.sign(
      { sub: '64b000000000000000000001', type: 'access' },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: -10 },
    );
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  test('forged/invalid access token → 401 AUTH_INVALID_TOKEN', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  test('no token → 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('valid token for a deleted account → 401 AUTH_USER_NOT_FOUND', async () => {
    const me = await register();
    await User.deleteOne({ _id: me.user.id });
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_USER_NOT_FOUND');
  });
});

describe('GET /users/:id — public profile', () => {
  test('success → public shape, no email / passwordHash / moderation', async () => {
    const author = await register();
    const viewer = await register();

    const res = await request(app)
      .get(`/api/v1/users/${author.user.id}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe(author.user.username);
    expect(res.body.data.followerCount).toBe(0);
    expect(res.body.data).not.toHaveProperty('email');
    expect(res.body.data).not.toHaveProperty('moderation');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.body.data.isFollowing).toBe(false);
  });

  test('self profile includes private fields (email, moderation)', async () => {
    const me = await register();
    const res = await request(app)
      .get(`/api/v1/users/${me.user.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(me.user.email);
    expect(res.body.data.moderation.status).toBe('active');
  });

  test('unknown user → 404 USER_NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/users/64b000000000000000000abc');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('PATCH /users/me — profile update + mass-assign protection (§7 step 30)', () => {
  test('updates displayName/bio and returns them', async () => {
    const me = await register();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ displayName: 'Renamed Poet', bio: 'I write verses at midnight.' });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Renamed Poet');
    expect(res.body.data.bio).toBe('I write verses at midnight.');

    const persisted = await User.findById(me.user.id).lean();
    expect(persisted.displayName).toBe('Renamed Poet');
  });

  test('privileged fields in the body are IGNORED (never mass-assigned)', async () => {
    const me = await register();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({
        displayName: 'Sneaky',
        roles: { security: 'admin', product: ['curator'] },
        followerCount: 99999,
        moderation: { status: 'banned' },
        email: 'attacker@example.com',
        passwordHash: '$2b$12$abcdef',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Sneaky');

    const persisted = await User.findById(me.user.id).lean();
    expect(persisted.roles.security).toBe('user');
    expect(persisted.followerCount).toBe(0);
    expect(persisted.moderation.status).toBe('active');
    expect(persisted.email).toBe(me.user.email);
  });

  test('empty body → 400 with field detail', async () => {
    const me = await register();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field.includes('(root)'))).toBe(true);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(app).patch('/api/v1/users/me').send({ displayName: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('follow / unfollow (§7 step 31 — atomic $inc, clean 409)', () => {
  test('follow → 201, both counters increment atomically', async () => {
    const a = await register();
    const b = await register();

    const res = await request(app)
      .post(`/api/v1/users/${b.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.following).toBe(true);
    expect(res.body.data.followerCount).toBe(1);
    expect(res.body.data.followingCount).toBe(1);

    const [bProfile, aProfile] = await Promise.all([
      request(app).get(`/api/v1/users/${b.user.id}`),
      request(app).get(`/api/v1/users/${a.user.id}`),
    ]);
    expect(bProfile.body.data.followerCount).toBe(1);
    expect(aProfile.body.data.followingCount).toBe(1);

    // viewer sees the relationship
    const asA = await request(app)
      .get(`/api/v1/users/${b.user.id}`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(asA.body.data.isFollowing).toBe(true);
  });

  test('duplicate follow → 409 ALREADY_FOLLOWING (unique index, not a raw Mongo error)', async () => {
    const a = await register();
    const b = await register();

    await request(app)
      .post(`/api/v1/users/${b.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const dup = await request(app)
      .post(`/api/v1/users/${b.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);

    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_FOLLOWING');

    // counters were NOT double-incremented
    const bProfile = await request(app).get(`/api/v1/users/${b.user.id}`);
    expect(bProfile.body.data.followerCount).toBe(1);
  });

  test('self-follow → 400 CANNOT_FOLLOW_SELF', async () => {
    const a = await register();
    const res = await request(app)
      .post(`/api/v1/users/${a.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_FOLLOW_SELF');
  });

  test('follow unknown user → 404 USER_NOT_FOUND', async () => {
    const a = await register();
    const res = await request(app)
      .post('/api/v1/users/64b000000000000000000abc/follow')
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  test('unfollow → 200, counters decrement back to 0', async () => {
    const a = await register();
    const b = await register();
    await request(app)
      .post(`/api/v1/users/${b.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);

    const res = await request(app)
      .delete(`/api/v1/users/${b.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.following).toBe(false);
    expect(res.body.data.followerCount).toBe(0);
    expect(res.body.data.followingCount).toBe(0);
  });

  test('unfollow when not following → 409 NOT_FOLLOWING', async () => {
    const a = await register();
    const b = await register();
    const res = await request(app)
      .delete(`/api/v1/users/${b.user.id}/follow`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_FOLLOWING');
  });

  test('unauthenticated follow → 401', async () => {
    const b = await register();
    const res = await request(app).post(`/api/v1/users/${b.user.id}/follow`);
    expect(res.status).toBe(401);
  });
});

describe('POST /users/me/photo — clean upload failure paths (§7.1)', () => {
  test('missing file → 400 PHOTO_REQUIRED', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/users/me/photo')
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PHOTO_REQUIRED');
  });

  test('non-image file → 400 INVALID_FILE_TYPE', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/users/me/photo')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .attach('photo', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  test('Cloudinary unconfigured → 503 UPLOAD_UNAVAILABLE (AppError, not a raw SDK crash)', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/users/me/photo')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .attach('photo', Buffer.from('fake-image-bytes'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      });

    // .env in this environment has no Cloudinary credentials
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UPLOAD_UNAVAILABLE');
    expect(res.body.success).toBe(false);
  });
});
