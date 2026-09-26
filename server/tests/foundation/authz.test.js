'use strict';

const {
  assertOwner,
  assertOwnerOrModerator,
  assertAdmin,
  isModerator,
} = require('../../src/middleware/authz');

const poem = { id: 'p1', authorId: { toString: () => 'author-1' } };
const owner = { id: 'author-1' };
const stranger = { id: 'someone-else' };
const moderator = { id: 'mod-1', role: 'moderator' };
const admin = { id: 'admin-1', role: 'admin' };

describe('assertOwner', () => {
  test('owner passes', () => {
    expect(assertOwner(poem, owner)).toBe(true);
  });

  test('string/ObjectId-like ids compare loosely', () => {
    expect(assertOwner({ authorId: 'author-1' }, owner)).toBe(true);
  });

  test('wrong user → 403 FORBIDDEN', () => {
    try {
      assertOwner(poem, stranger);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    }
  });

  test('anonymous → 401 AUTH_REQUIRED', () => {
    try {
      assertOwner(poem, undefined);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('AUTH_REQUIRED');
    }
  });

  test('missing resource → 404 (existence not leaked)', () => {
    try {
      assertOwner(null, owner);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.statusCode).toBe(404);
    }
  });
});

describe('assertOwnerOrModerator', () => {
  test('owner passes', () => {
    expect(assertOwnerOrModerator(poem, owner)).toBe(true);
  });

  test('moderator passes for someone else\'s resource', () => {
    expect(assertOwnerOrModerator(poem, moderator)).toBe(true);
    expect(assertOwnerOrModerator(poem, admin)).toBe(true);
  });

  test('stranger → 403', () => {
    expect(() => assertOwnerOrModerator(poem, stranger)).toThrow(/Not allowed/);
  });
});

describe('assertAdmin / isModerator', () => {
  test('admin passes, moderator and normal user are forbidden', () => {
    expect(assertAdmin(admin)).toBe(true);
    expect(() => assertAdmin(moderator)).toThrow();
    expect(() => assertAdmin(owner)).toThrow();
  });

  test('isModerator recognizes both moderator and admin roles', () => {
    expect(isModerator(moderator)).toBe(true);
    expect(isModerator(admin)).toBe(true);
    expect(isModerator(owner)).toBe(false);
    expect(isModerator(null)).toBe(false);
  });
});
