'use strict';

/**
 * Mixed-feed item serializer (plan 41B): every feed/discovery/profile listing
 * speaks this one shape so a poem, story, or diary entry is never ambiguous —
 * `type` is the discriminator, per-type details ride under the same keys.
 */

const EXCERPT_LENGTH = 200;

function excerptOf(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT_LENGTH) return flat;
  return `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

function serializeFeedItem(type, item, author = null) {
  const base = {
    type,
    id: String(item._id),
    title: item.title || '',
    status: item.status,
    publishedAt: item.publishedAt || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stats: item.stats || null,
    author,
  };

  if (type === 'poem') {
    return {
      ...base,
      excerpt: excerptOf(item.content),
      language: item.language,
      moods: item.moods || [],
      tags: item.tags || [],
      anonymous: Boolean(item.anonymous),
    };
  }

  if (type === 'story') {
    return {
      ...base,
      excerpt: excerptOf(item.synopsis),
      coverUrl: item.coverUrl || '',
      chapterCount: item.chapterCount ?? 0,
      tags: item.tags || [],
      language: item.language,
    };
  }

  if (type === 'diary') {
    return { ...base, excerpt: excerptOf(item.content), mood: item.mood || '' };
  }

  throw new Error(`Unknown feed item type: ${type}`);
}

module.exports = { serializeFeedItem, excerptOf };
