'use strict';

const { Schema } = require('mongoose');

/**
 * Base schema factory (Phase 0.5 step 14). Every Verso model uses this so
 * `timestamps`, `toJSON` shape, and ObjectId refs behave identically across
 * the whole codebase (§7.1: no leaking internal fields to clients).
 *
 * Options:
 *   strip: ['secretField'] — extra keys to delete in toJSON output
 *   any other mongoose schema option passes through.
 */
function createSchema(definition, options = {}) {
  const { strip = [], toJSON, ...rest } = options;

  return new Schema(definition, {
    timestamps: true,
    versionKey: false,
    minimize: false,
    ...rest,
    toJSON: {
      ...toJSON,
      transform(_doc, ret) {
        delete ret.__v;
        for (const key of strip) delete ret[key];
        // Expose a stable string `id` and drop Mongo's `_id` so every API
        // response uses the same identifier shape as the public serializers.
        if (ret._id !== undefined) {
          ret.id = String(ret._id);
          delete ret._id;
        }
        if (typeof toJSON?.transform === 'function') return toJSON.transform(_doc, ret);
        return ret;
      },
    },
  });
}

/** Standard ObjectId reference field. */
function refField(ref, { required = true, index = false } = {}) {
  const field = { type: Schema.Types.ObjectId, ref };
  if (required) field.required = true;
  if (index) field.index = true;
  return field;
}

module.exports = { createSchema, refField, ObjectId: Schema.Types.ObjectId };
