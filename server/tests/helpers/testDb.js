'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const os = require('os');

/**
 * Per-suite MongoDB instance (§7.4: integration tests run against a test
 * MongoDB, e.g. mongodb-memory-server). Call startTestDb in beforeAll and
 * stopTestDb in afterAll; pass the models so schema indexes (unique
 * constraints) are ensured before the first write.
 *
 * runtimeAdapters: mongodb driver >=7.6 breaks under Jest (NODE-7832 — its
 * runtime adapter resolution throws, hello is sent without driver info and
 * the server rejects it with "Missing required sub-document 'driver'").
 * Passing `os` explicitly is the upstream-documented workaround.
 */
async function startTestDb(models = []) {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('verso_test'), { runtimeAdapters: { os } });
  await Promise.all(models.map((m) => m.init()));
  return mongod;
}

async function stopTestDb(mongod) {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

module.exports = { startTestDb, stopTestDb };
