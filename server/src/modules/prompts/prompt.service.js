'use strict';

const { NotFoundError, ForbiddenError, ConflictError, ValidationError } = require('../../errors');
const { Prompt } = require('./prompt.model');
const { PromptSubmission } = require('./prompt-submission.model');
const { Poem } = require('../poems/poem.model');
const { User } = require('../users/user.model');
const { canView } = require('../poems/poem.service');
const { serializeFeedItem } = require('../../serializers/feed-item.serializer');

/**
 * Prompt service (plan step 69):
 *
 * - `GET /prompts/current` → newest prompt with `weekOf <= now` (404 when no
 *   prompt covers the current week) plus the requester's own submission.
 * - `POST /prompts/:id/submissions` (mobile entry point): the poem must be the
 *   caller's own and published; uniqueness is enforced by the
 *   `(promptId, userId)` index → 11000 maps to 409, no counter to roll back.
 * - Submissions list hydrates poems in batches (no N+1, §8.4) and runs each
 *   through `canView`, dropping rows the requester may not read.
 */

const promptNotFound = () =>
  new NotFoundError('Prompt not found', { code: 'PROMPT_NOT_FOUND' });

function serializePrompt(prompt) {
  return {
    id: String(prompt._id),
    text: prompt.text,
    weekOf: prompt.weekOf,
    featuredPoemIds: (prompt.featuredPoemIds || []).map(String),
    createdAt: prompt.createdAt,
  };
}

function serializeSubmission(sub, poemItem) {
  return {
    id: String(sub._id),
    promptId: String(sub.promptId),
    poemId: String(sub.poemId),
    createdAt: sub.createdAt,
    poem: poemItem,
  };
}

function serializeAuthor(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

/** Batch author lookup for a page (§8.4 — one User query, never per item). */
async function serializePoems(poems, requester) {
  const viewable = [];
  for (const p of poems) {
    if (await canView(p, requester)) viewable.push(p);
  }
  const ids = [
    ...new Set(viewable.filter((p) => !p.anonymous && p.authorId).map((p) => String(p.authorId))),
  ];
  const authors = ids.length
    ? await User.find({ _id: { $in: ids } })
        .select('username displayName profilePhotoUrl')
        .lean()
    : [];
  const byId = new Map(authors.map((a) => [String(a._id), a]));
  return viewable.map((p) => {
    const author = p.anonymous ? null : byId.get(String(p.authorId)) || null;
    return serializeFeedItem('poem', p, serializeAuthor(author));
  });
}

async function getCurrent(user) {
  const now = new Date();
  const prompt = await Prompt.findOne({ weekOf: { $lte: now } })
    .sort({ weekOf: -1, createdAt: -1 })
    .lean();
  if (!prompt) {
    throw new NotFoundError('No prompt is active for the current week', {
      code: 'NO_PROMPT',
    });
  }

  let mySubmission = null;
  if (user) {
    const sub = await PromptSubmission.findOne({ promptId: prompt._id, userId: user.id }).lean();
    if (sub) {
      mySubmission = {
        id: String(sub._id),
        promptId: String(sub.promptId),
        poemId: String(sub.poemId),
        createdAt: sub.createdAt,
      };
    }
  }
  return { ...serializePrompt(prompt), mySubmission };
}

async function submit(user, promptId, { poemId }) {
  const prompt = await Prompt.findById(promptId).lean();
  if (!prompt) throw promptNotFound();

  const poem = await Poem.findById(poemId).select('authorId status').lean();
  if (!poem) {
    throw new NotFoundError('Poem not found', {
      code: 'POEM_NOT_FOUND',
      details: [{ field: 'poemId', message: 'poem does not exist', code: 'not_found' }],
    });
  }
  if (String(poem.authorId) !== String(user.id)) {
    throw new ForbiddenError('You can only submit your own poems', { code: 'FORBIDDEN' });
  }
  if (poem.status !== 'published') {
    throw new ValidationError('Poem must be published to submit', {
      code: 'POEM_NOT_PUBLISHED',
      details: [{ field: 'poemId', message: 'must be a published poem', code: 'custom' }],
    });
  }

  let sub;
  try {
    sub = await PromptSubmission.create({ promptId: prompt._id, userId: user.id, poemId });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError('You have already submitted to this prompt', {
        code: 'ALREADY_SUBMITTED',
      });
    }
    throw err;
  }
  return {
    id: String(sub._id),
    promptId: String(prompt._id),
    poemId: String(poemId),
    createdAt: sub.createdAt,
  };
}

async function listSubmissions(promptId, user, query = {}) {
  const prompt = await Prompt.findById(promptId).lean();
  if (!prompt) throw promptNotFound();

  const limit = query.limit ?? 20;
  const filter = { promptId: prompt._id };
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const docs = await PromptSubmission.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];

  const poems = await Poem.find({ _id: { $in: page.map((s) => s.poemId) } }).lean();
  const byId = new Map(poems.map((p) => [String(p._id), p]));
  const present = page.filter((s) => byId.has(String(s.poemId)));
  const items = await serializePoems(present.map((s) => byId.get(String(s.poemId))), user);
  const itemByPoemId = new Map(items.map((it) => [it.id, it]));

  return {
    items: present
      .map((s) => serializeSubmission(s, itemByPoemId.get(String(s.poemId))))
      .filter((it) => it.poem),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
  };
}

module.exports = { getCurrent, submit, listSubmissions };
