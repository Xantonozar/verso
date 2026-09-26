'use strict';

const {
  registerSchema,
  loginSchema,
  refreshSchema,
} = require('../../src/modules/auth/auth.schemas');
const { updateProfileSchema } = require('../../src/modules/users/user.schemas');

const validRegister = {
  username: 'quiet_poet',
  displayName: 'Quiet Poet',
  email: 'poet@example.com',
  password: 'Str0ngPass',
};

describe('registerSchema — password strength (unit)', () => {
  test('accepts a valid payload (trim applied)', () => {
    const result = registerSchema.safeParse({ ...validRegister, username: '  quiet_poet  ' });
    expect(result.success).toBe(true);
    expect(result.data.username).toBe('quiet_poet');
  });

  test.each([
    ['too short', 'Ab1'],
    ['no digit', 'LongPassword'],
    ['no letter', '1234567890'],
    ['empty', ''],
  ])('rejects password %s', (_label, password) => {
    const result = registerSchema.safeParse({ ...validRegister, password });
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'password')).toBe(true);
  });

  test.each([['ab'], ['has space'], ['bad!char'], ['']])('rejects username %s', (username) => {
    const result = registerSchema.safeParse({ ...validRegister, username });
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'username')).toBe(true);
  });

  test('rejects invalid email', () => {
    const result = registerSchema.safeParse({ ...validRegister, email: 'nope' });
    expect(result.success).toBe(false);
    expect(result.error.issues.some((i) => i.path[0] === 'email')).toBe(true);
  });

  test('lowercases email', () => {
    const result = registerSchema.safeParse({ ...validRegister, email: 'Poet@Example.COM' });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe('poet@example.com');
  });
});

describe('loginSchema', () => {
  test('requires identifier and password', () => {
    expect(loginSchema.safeParse({}).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: 'x', password: 'y' }).success).toBe(true);
  });
});

describe('refreshSchema', () => {
  test('requires refreshToken', () => {
    expect(refreshSchema.safeParse({}).success).toBe(false);
    expect(refreshSchema.safeParse({ refreshToken: 'abc' }).success).toBe(true);
  });
});

describe('updateProfileSchema — allow-list semantics (unit)', () => {
  test('accepts the three updatable fields', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'New Name',
      bio: 'hi',
      language: 'bn',
    });
    expect(result.success).toBe(true);
  });

  test('STRIPS unknown/privileged keys (mass-assign can never reach the service)', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'New Name',
      roles: { security: 'admin' },
      followerCount: 999,
      email: 'x@y.z',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ displayName: 'New Name' });
    expect(result.data).not.toHaveProperty('roles');
    expect(result.data).not.toHaveProperty('followerCount');
  });

  test('rejects an empty patch', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });

  test('rejects an invalid language', () => {
    const result = updateProfileSchema.safeParse({ language: 'fr' });
    expect(result.success).toBe(false);
  });
});
