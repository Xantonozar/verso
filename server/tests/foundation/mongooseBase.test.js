'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../src/models/base');

describe('createSchema base (step 14)', () => {
  const schema = createSchema(
    {
      title: { type: String, required: true },
      secretToken: { type: String },
      authorId: refField('User'),
    },
    { strip: ['secretToken'] },
  );
  const Model = mongoose.model('BaseTestPoem', schema);

  test('enables timestamps and drops versionKey', () => {
    expect(schema.options.timestamps).toBe(true);
    expect(schema.options.versionKey).toBe(false);
  });

  test('refField produces a required ObjectId ref', () => {
    const path = schema.paths.authorId;
    expect(path.instance).toBe('ObjectId');
    expect(path.options.ref).toBe('User');
    expect(path.isRequired).toBe(true);
  });

  test('toJSON strips __v and configured fields', async () => {
    const doc = new Model({
      title: 'Hello',
      secretToken: 'shh',
      authorId: new mongoose.Types.ObjectId(),
    });
    // timestamps populate on save; set manually to stay offline
    doc.createdAt = new Date();
    doc.updatedAt = new Date();
    const json = doc.toJSON();
    expect(json.title).toBe('Hello');
    expect(json.__v).toBeUndefined();
    expect(json.secretToken).toBeUndefined();
    expect(String(json.authorId)).toMatch(/^[0-9a-f]{24}$/);
    expect(json.createdAt).toBeInstanceOf(Date);
  });
});
