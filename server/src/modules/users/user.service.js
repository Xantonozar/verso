'use strict';

const { cloudinary, isCloudinaryConfigured } = require('../../config/cloudinary');
const { AppError, NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { User } = require('./user.model');
const { Follow } = require('./follow.model');
const userRepo = require('./user.repository');
const notificationsDispatcher = require('../notifications/notifications.dispatcher');

/**
 * User service (Phase 1 steps 30–31): profiles, follow/unfollow, photo upload.
 * Count updates are always atomic `$inc` (§10.19) — never read-then-write.
 */

const PUBLIC_FIELDS =
  'username displayName bio profilePhotoUrl followerCount followingCount language roles.product createdAt';

const PRIVATE_FIELDS = `${PUBLIC_FIELDS} email roles.security moderation readingStreak updatedAt`;

function publicProfile(user, { isSelf = false, isFollowing } = {}) {
  const base = {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    bio: user.bio || '',
    profilePhotoUrl: user.profilePhotoUrl || '',
    followerCount: user.followerCount,
    followingCount: user.followingCount,
    language: user.language,
    productRoles: user.roles?.product || [],
    createdAt: user.createdAt,
  };
  if (isFollowing !== undefined) base.isFollowing = isFollowing;
  if (isSelf) {
    base.email = user.email;
    base.securityRole = user.roles?.security;
    base.moderation = user.moderation;
    base.readingStreak = user.readingStreak;
    base.updatedAt = user.updatedAt;
  }
  return base;
}

async function getProfile(targetId, requester) {
  const user = await userRepo.findById(targetId, { select: PRIVATE_FIELDS });
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });

  const isSelf = requester?.id != null && String(requester.id) === String(user._id);
  let isFollowing;
  if (requester?.id && !isSelf) {
    isFollowing = Boolean(
      await Follow.exists({ followerId: requester.id, followingId: user._id }),
    );
  }
  return publicProfile(user, { isSelf, isFollowing });
}

async function getMe(userId) {
  const user = await userRepo.findById(userId, { select: PRIVATE_FIELDS });
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  return publicProfile(user, { isSelf: true });
}

/**
 * Explicit allow-list update (§7 step 30): only displayName/bio/language are
 * ever written, regardless of what else the request body contains.
 */
const UPDATABLE_FIELDS = ['displayName', 'bio', 'language'];

async function updateProfile(userId, patch) {
  const fields = {};
  for (const key of UPDATABLE_FIELDS) {
    if (patch[key] !== undefined) fields[key] = patch[key];
  }
  if (Object.keys(fields).length === 0) {
    throw new ValidationError('No updatable fields provided', {
      details: { field: '(root)', allowed: UPDATABLE_FIELDS },
    });
  }
  const user = await userRepo.updateProfile(userId, fields);
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  return publicProfile(user, { isSelf: true });
}

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'verso/avatars',
        transformation: [{ width: 512, height: 512, crop: 'fill' }],
        resource_type: 'image',
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    stream.end(buffer);
  });
}

async function uploadProfilePhoto(userId, file) {
  if (!file) {
    throw new ValidationError('A photo file is required', {
      code: 'PHOTO_REQUIRED',
      details: { field: 'photo' },
    });
  }
  if (!isCloudinaryConfigured()) {
    // Optional-dependency degradation (§7.1): clean AppError, never a raw SDK crash.
    throw new AppError('Media uploads are temporarily unavailable', {
      statusCode: 503,
      code: 'UPLOAD_UNAVAILABLE',
    });
  }

  let result;
  try {
    result = await uploadToCloudinary(file.buffer);
  } catch (err) {
    throw new AppError('Photo upload failed — please try again', {
      statusCode: 502,
      code: 'UPLOAD_FAILED',
      details: { reason: err?.message },
    });
  }

  const user = await userRepo.updateProfile(userId, { profilePhotoUrl: result.secure_url });
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  return publicProfile(user, { isSelf: true });
}

async function follow(targetId, followerId) {
  if (String(targetId) === String(followerId)) {
    throw new ValidationError('You cannot follow yourself', { code: 'CANNOT_FOLLOW_SELF' });
  }

  const target = await User.findById(targetId).select('_id').lean();
  if (!target) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });

  try {
    await Follow.create({ followerId, followingId: targetId });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError('You already follow this user', { code: 'ALREADY_FOLLOWING' });
    }
    throw err;
  }

  // Atomic $inc on both counters (§10.19) — only after the unique edge exists.
  const [follower, targetDoc] = await Promise.all([
    userRepo.incrementCounts(followerId, { followingCount: 1 }),
    userRepo.incrementCounts(targetId, { followerCount: 1 }),
  ]);

  // Follow notification (Phase 11 step 79) — fire-and-forget, never blocks
  // the response; the worker resolves the follower's display name itself.
  notificationsDispatcher.dispatchNotification({
    recipientId: targetId,
    type: 'follow',
    relatedType: 'user',
    relatedId: followerId,
    eventKey: `follow:${followerId}:${targetId}`,
    actor: { id: followerId },
  });

  return {
    following: true,
    followerCount: targetDoc.followerCount,
    followingCount: follower.followingCount,
  };
}

async function unfollow(targetId, followerId) {
  const res = await Follow.deleteOne({ followerId, followingId: targetId });
  if (res.deletedCount === 0) {
    throw new ConflictError('You do not follow this user', { code: 'NOT_FOLLOWING' });
  }

  const [follower, targetDoc] = await Promise.all([
    userRepo.incrementCounts(followerId, { followingCount: -1 }),
    userRepo.incrementCounts(targetId, { followerCount: -1 }),
  ]);

  return {
    following: false,
    followerCount: targetDoc.followerCount,
    followingCount: follower.followingCount,
  };
}

/** Store (or clear, with null/'') the Expo push token - Phase 11 step 80. */
async function setPushToken(userId, token) {
  const value = token || '';
  await User.updateOne({ _id: userId }, { $set: { pushToken: value } });
  return { pushToken: value };
}

module.exports = {
  getProfile,
  getMe,
  updateProfile,
  uploadProfilePhoto,
  follow,
  unfollow,
  setPushToken,
};
