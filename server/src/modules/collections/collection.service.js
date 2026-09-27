'use strict';

const { NotFoundError, ForbiddenError, ConflictError } = require('../../errors');
const { isModerator } = require('../../middleware/authz');
const { logger } = require('../../config/logger');
const { serializeFeedItem } = require('../../serializers/feed-item.serializer');
const { canView: poemCanView } = require('../poems/poem.service');
const { Poem } = require('../poems/poem.model');
const { User } = require('../users/user.model');
const { Follow } = require('../users/follow.model');
const repo = require('./collection.repository');

/**
 * Collections service (plan step 58). The visibility matrix mirrors poem/
 * diary (owner/moderator always, public everyone, followers needs an edge,
 * private owner-only) and every unauthorized view fails closed as 404 so
 * existence is never leaked (§7.1). Mutations are owner-only: a viewable
 * collection touched by a non-owner is 403.
 *
 * Only the detail read hydrates poems — list stays a cheap summary page
 * (§10.2 projection). Hydration runs each poem through the poem module's own
 * `canView`, so an unpublished/removed poem drops out for everyone but its
 * author/moderator; diary ids can never match (separate collection).
 */

const COLLECT_FIELDS = 'ownerId title description visibility poemIds createdAt updatedAt';
const POEM_FIELDS =
  '_id title content language moods tags anonymous status visibility ' +
  'stats publishedAt createdAt updatedAt authorId';
const AUTHOR_FIELDS = 'username displayName profilePhotoUrl';

const notFound = () =>
  new NotFoundError('Collection not found', { code: 'COLLECTION_NOT_FOUND' });
const poemNotFound = () => new NotFoundError('Poem not found', { code: 'POEM_NOT_FOUND' });
const notInCollection = () =>
  new NotFoundError('Poem is not in this collection', { code: 'POEM_NOT_IN_COLLECTION' });
const alreadyIn = () =>
  new ConflictError('Poem already in this collection', { code: 'POEM_IN_COLLECTION' });

async function canView(collection, requester) {
  if (requester?.id != null && String(collection.ownerId) === String(requester.id)) return true;
  if (isModerator(requester)) return true;
  if (collection.visibility === 'public') return true;
  if (collection.visibility === 'followers') {
    if (!requester?.id) return false;
    return Boolean(
      await Follow.exists({ followerId: requester.id, followingId: collection.ownerId }),
    );
  }
  return false;
}

function serializeAuthor(user) {
  return {
    id: String(user._id ?? user.id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

function serialize(collection) {
  const poemIds = (collection.poemIds ?? []).map(String);
  return {
    id: String(collection._id),
    ownerId: String(collection.ownerId),
    title: collection.title,
    description: collection.description || '',
    visibility: collection.visibility,
    poemIds,
    poemCount: poemIds.length,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

async function loadViewable(id, requester) {
  const collection = await repo.findById(id, { select: COLLECT_FIELDS });
  if (!collection) throw notFound();
  if (!(await canView(collection, requester))) throw notFound();
  return collection;
}

/** Mutation gate: 404 first (private stays hidden), then 403 non-owner. */
async function loadOwned(id, requester) {
  const collection = await loadViewable(id, requester);
  if (String(collection.ownerId) !== String(requester.id)) {
    throw new ForbiddenError('Only the owner can change this collection', {
      code: 'FORBIDDEN',
    });
  }
  return collection;
}

/**
 * Hydrate poems for the detail read, preserving `poemIds` order and dropping
 * anything the requester can no longer view (one batched author query, §8.4).
 */
async function hydratePoems(poemIds, requester) {
  if (!poemIds.length) return [];
  const rows = await Poem.find({ _id: { $in: poemIds } }).select(POEM_FIELDS).lean();

  const visible = [];
  for (const row of rows) {
    if (await poemCanView(row, requester)) visible.push(row);
  }
  const byId = new Map(visible.map((p) => [String(p._id), p]));
  const ordered = poemIds.map((pid) => byId.get(String(pid))).filter(Boolean);
  if (!ordered.length) return [];

  const authorIds = [
    ...new Set(
      ordered.filter((p) => !p.anonymous && p.authorId).map((p) => String(p.authorId)),
    ),
  ];
  const authors = authorIds.length
    ? await User.find({ _id: { $in: authorIds } }).select(AUTHOR_FIELDS).lean()
    : [];
  const authorById = new Map(authors.map((a) => [String(a._id), a]));

  return ordered.map((p) => {
    const authorDoc = p.anonymous ? null : authorById.get(String(p.authorId)) || null;
    return serializeFeedItem('poem', p, authorDoc ? serializeAuthor(authorDoc) : null);
  });
}

async function createCollection(user, body) {
  const collection = await repo.create({
    ownerId: user.id,
    title: body.title,
    description: body.description ?? '',
    visibility: body.visibility ?? 'public',
  });
  logger.info({ collectionId: String(collection._id), userId: user.id }, 'collection created');
  return serialize(collection);
}

/** Owner's collections only (the hub is "your lists", plan step 59). */
async function listCollections(user, query) {
  const limit = query.limit ?? 20;
  const rows = await repo.findOwnedBy(user.id, { cursor: query.cursor ?? null, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: kept.map(serialize),
    nextCursor: hasMore && kept.length ? kept[kept.length - 1].createdAt.toISOString() : null,
  };
}

async function getCollection(id, requester) {
  const collection = await loadViewable(id, requester);
  return { ...serialize(collection), poems: await hydratePoems(collection.poemIds, requester) };
}

async function addPoem(collectionId, user, poemId) {
  const collection = await loadOwned(collectionId, user);
  if (collection.poemIds.map(String).includes(poemId)) throw alreadyIn();

  // Eligibility = the poem the OWNER can view (own drafts included; other
  // people's drafts/removes fail closed). Diary ids simply don't exist here.
  const poem = await Poem.findById(poemId).select('authorId status visibility').lean();
  if (!poem || !(await poemCanView(poem, user))) throw poemNotFound();

  const res = await repo.addPoem(collectionId, user.id, poemId);
  if (res.matchedCount === 0) throw alreadyIn(); // lost a add/add race

  logger.info({ collectionId, poemId, userId: user.id }, 'poem added to collection');
  const updated = await repo.findById(collectionId, { select: COLLECT_FIELDS });
  return serialize(updated);
}

async function removePoem(collectionId, user, poemId) {
  const collection = await loadOwned(collectionId, user);
  if (!collection.poemIds.map(String).includes(poemId)) throw notInCollection();
  await repo.removePoem(collectionId, user.id, poemId);
  logger.info({ collectionId, poemId, userId: user.id }, 'poem removed from collection');
}

module.exports = {
  canView,
  createCollection,
  listCollections,
  getCollection,
  addPoem,
  removePoem,
};
