'use strict';

const { RefreshToken } = require('./refresh-token.model');

/**
 * RefreshToken repository (§3.1a). Rotation is claimed atomically:
 * `claimActive` flips active → rotated only if it is still active, so two
 * concurrent refreshes with the same token can never both succeed.
 */
async function create({ userId, familyId, tokenHash, userAgent, ip, expiresAt }) {
  return RefreshToken.create({ userId, familyId, tokenHash, userAgent, ip, expiresAt });
}

async function findByHash(tokenHash) {
  return RefreshToken.findOne({ tokenHash }).exec();
}

/** Returns the doc if it was still active (rotation claim), null otherwise. */
async function claimActive(tokenId) {
  return RefreshToken.findOneAndUpdate(
    { _id: tokenId, status: 'active' },
    { $set: { status: 'rotated' } },
    { new: true },
  ).exec();
}

async function setReplacedBy(tokenId, newTokenId) {
  return RefreshToken.updateOne({ _id: tokenId }, { $set: { replacedByTokenId: newTokenId } });
}

async function revokeFamily(familyId) {
  const res = await RefreshToken.updateMany(
    { familyId, status: { $ne: 'revoked' } },
    { $set: { status: 'revoked' } },
  );
  return res.modifiedCount;
}

async function revokeAllForUser(userId) {
  const res = await RefreshToken.updateMany(
    { userId, status: { $ne: 'revoked' } },
    { $set: { status: 'revoked' } },
  );
  return res.modifiedCount;
}

async function revokeToken(tokenId) {
  return RefreshToken.updateOne(
    { _id: tokenId, status: 'active' },
    { $set: { status: 'revoked' } },
  );
}

module.exports = {
  create,
  findByHash,
  claimActive,
  setReplacedBy,
  revokeFamily,
  revokeAllForUser,
  revokeToken,
};
