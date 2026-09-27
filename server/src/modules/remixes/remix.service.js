'use strict';

const { NotFoundError, ValidationError } = require('../../errors');
const { Remix } = require('./remix.model');
const { Poem } = require('../poems/poem.model');
const { PoemVersion } = require('../poems/poem-version.model');
const poemService = require('../poems/poem.service');

/**
 * Remix service (plan step 70): the original must exist and be publicly
 * readable (published AND public/unlisted — requester-independent, per the
 * plan), then one flow creates the new poem (as its author, published) and
 * the attribution link. Any failure rolls the fresh poem back.
 */

const VIEWABLE_VISIBILITIES = ['public', 'unlisted'];

const notFound = () => new NotFoundError('Poem not found', { code: 'POEM_NOT_FOUND' });

function serialize(remix) {
  return {
    id: String(remix._id),
    originalPoemId: String(remix.originalPoemId),
    remixPoemId: String(remix.remixPoemId),
    createdAt: remix.createdAt,
  };
}

async function assertOriginalReadable(originalPoemId) {
  const original = await Poem.findById(originalPoemId)
    .select('status visibility')
    .lean();
  if (!original) throw notFound();
  if (original.status !== 'published' || !VIEWABLE_VISIBILITIES.includes(original.visibility)) {
    throw new ValidationError('Original poem is not publicly readable', {
      code: 'ORIGINAL_NOT_PUBLIC',
      details: [
        { field: 'originalPoemId', message: 'must be a published public poem', code: 'custom' },
      ],
    });
  }
  return original;
}

async function createRemix(user, input) {
  await assertOriginalReadable(input.originalPoemId);
  const { originalPoemId, ...poemInput } = input;

  const createdPoem = await poemService.createPoem(user.id, poemInput);
  try {
    const published = await poemService.publishPoem(createdPoem.id, user);
    const remix = await Remix.create({ originalPoemId, remixPoemId: createdPoem.id });
    return { remix: serialize(remix), poem: published };
  } catch (err) {
    // Roll the fresh poem back — a half-created remix must never linger.
    await Poem.deleteOne({ _id: createdPoem.id });
    await PoemVersion.deleteMany({ poemId: createdPoem.id });
    await Remix.deleteOne({ remixPoemId: createdPoem.id });
    throw err;
  }
}

module.exports = { createRemix, assertOriginalReadable };
