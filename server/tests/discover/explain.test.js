'use strict';

const { User } = require('../../src/modules/users/user.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan step 53 explain gate: every hot discovery/feed query must win an
 * IXSCAN on its §4 index — never a COLLSCAN (plan 5.1/5.5, §10.1).
 *
 * Seeds keep selective equality prefixes narrow (planner economics: index
 * range beats a full scan even on a small corpus).
 */
let mongod;

async function planOf(query) {
  const explain = await query.explain('executionStats');
  const json = JSON.stringify(explain);
  return { json, hasIxScan: json.includes('IXSCAN'), hasCollScan: json.includes('COLLSCAN') };
}

beforeAll(async () => {
  mongod = await startTestDb([User, Follow, Poem]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Poem.deleteMany({});
});

describe('explain() — no COLLSCAN on discovery hot paths (plan 5.1 gate)', () => {
  test('mood discovery wins IXSCAN on { moods, status, visibility, createdAt }', async () => {
    const author = await User.findOne({}) || (await User.create({
      username: 'explainer1',
      displayName: 'Ex',
      email: 'ex1@example.com',
      passwordHash: 'x',
    }));
    // narrow selective prefix: 6 of 80 docs carry the mood
    const docs = [];
    for (let i = 0; i < 80; i++) {
      docs.push({
        authorId: author._id,
        title: `E${i}`,
        content: 'explain me',
        status: i < 6 ? 'published' : 'draft',
        visibility: 'public',
        moods: i < 6 ? ['rain'] : ['other'],
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      });
    }
    await Poem.insertMany(docs);

    const { hasIxScan, hasCollScan, json } = await planOf(
      Poem.find({ moods: 'rain', status: 'published', visibility: 'public' })
        .sort({ createdAt: -1 })
        .limit(21),
    );

    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('moods_1_status_1_visibility_1_createdAt_-1');
  });

  test('tag discovery wins IXSCAN on { tags, status, createdAt }', async () => {
    const author =
      (await User.findOne({})) ||
      (await User.create({
        username: 'explainer2',
        displayName: 'Ex',
        email: 'ex2@example.com',
        passwordHash: 'x',
      }));
    const docs = [];
    for (let i = 0; i < 80; i++) {
      docs.push({
        authorId: author._id,
        title: `E${i}`,
        content: 'explain me',
        status: i < 6 ? 'published' : 'draft',
        visibility: 'public',
        tags: i < 6 ? ['nature'] : ['other'],
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      });
    }
    await Poem.insertMany(docs);

    const { hasIxScan, hasCollScan, json } = await planOf(
      Poem.find({ tags: 'nature', status: 'published', visibility: 'public' })
        .sort({ createdAt: -1 })
        .limit(21),
    );

    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('tags_1_status_1_createdAt_-1');
  });

  test('following feed wins IXSCAN on { authorId, status, createdAt }', async () => {
    const authors = [];
    for (let i = 0; i < 20; i++) {
      authors.push(
        await User.create({
          username: `feedex${i}`,
          displayName: 'Ex',
          email: `feedex${i}@example.com`,
          passwordHash: 'x',
        }),
      );
    }
    const docs = [];
    for (let i = 0; i < 80; i++) {
      const isTarget = i % 40 < 2; // 2 of 20 authors
      docs.push({
        authorId: authors[i % 20]._id,
        title: `E${i}`,
        content: 'explain me',
        status: isTarget ? 'published' : 'draft',
        visibility: 'public',
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      });
    }
    await Poem.insertMany(docs);

    const { hasIxScan, hasCollScan, json } = await planOf(
      Poem.find({
        authorId: { $in: [authors[0]._id, authors[1]._id] },
        status: 'published',
        visibility: { $in: ['public', 'followers'] },
      })
        .sort({ createdAt: -1 })
        .limit(21),
    );

    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('authorId_1_status_1_createdAt_-1');
  });

  test('trending fallback wins IXSCAN on { status, visibility, trendingScore }', async () => {
    const author =
      (await User.findOne({})) ||
      (await User.create({
        username: 'trendex',
        displayName: 'Ex',
        email: 'trendex@example.com',
        passwordHash: 'x',
      }));
    const docs = [];
    for (let i = 0; i < 80; i++) {
      docs.push({
        authorId: author._id,
        title: `E${i}`,
        content: 'explain me',
        status: i < 8 ? 'published' : 'draft',
        visibility: 'public',
        trendingScore: i * 3,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      });
    }
    await Poem.insertMany(docs);

    const { hasIxScan, hasCollScan, json } = await planOf(
      Poem.find({ status: 'published', visibility: 'public' })
        .sort({ trendingScore: -1 })
        .limit(20),
    );

    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('status_1_visibility_1_trendingScore_-1');
  });

  test('random picker query is index-served (no COLLSCAN)', async () => {
    const author =
      (await User.findOne({})) ||
      (await User.create({
        username: 'randex',
        displayName: 'Ex',
        email: 'randex@example.com',
        passwordHash: 'x',
      }));
    const docs = [];
    for (let i = 0; i < 80; i++) {
      docs.push({
        authorId: author._id,
        title: `E${i}`,
        content: 'explain me',
        status: i < 10 ? 'published' : 'draft',
        visibility: 'public',
        trendingScore: i,
        createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
      });
    }
    await Poem.insertMany(docs);

    const { hasIxScan, hasCollScan } = await planOf(
      Poem.find({ status: 'published', visibility: 'public' }).skip(3).limit(1),
    );

    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
  });
});
