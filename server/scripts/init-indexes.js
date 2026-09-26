'use strict';

/**
 * Phase 0.5 step 11 — create every §4 index against the connected database.
 * Usage: node scripts/init-indexes.js
 * Idempotent: createIndex with the same spec returns the existing index name.
 */

const { loadEnv } = require('../src/config/env');
loadEnv();

const { connectMongo, disconnectMongo, mongoose } = require('../src/config/db');
const indexes = require('../src/config/indexes');
const { logger } = require('../src/config/logger');

async function main() {
  await connectMongo();
  const db = mongoose.connection.db;

  for (const { collection, key, options = {} } of indexes) {
    const name = await db.collection(collection).createIndex(key, options);
    logger.info(
      { event: 'index:ensured', collection, index: name, key, options },
      'Index ensured',
    );
  }

  logger.info({ event: 'index:done', total: indexes.length }, `Ensured ${indexes.length} indexes`);
}

main()
  .then(() => disconnectMongo())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ event: 'index:failed', err: err.message }, 'Index creation failed');
    process.exit(1);
  });
