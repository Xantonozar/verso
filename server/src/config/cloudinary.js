'use strict';

const cloudinary = require('cloudinary').v2;
const { logger } = require('./logger');

/**
 * Cloudinary config. Uploads are routed through Express (§0) — never direct-to-client.
 * Failure contract (§0.4): upload failures must surface as a clean AppError upstream,
 * never a raw SDK exception. Callers wrap uploadBuffer/uploadRemote in try/catch and
 * rethrow AppError; this module only configures the SDK and logs config state.
 */
function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    logger.warn(
      { event: 'cloudinary:unconfigured' },
      'Cloudinary not configured — media uploads will fail until env vars are set',
    );
    return false;
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info({ event: 'cloudinary:configured' }, 'Cloudinary configured');
  return true;
}

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

module.exports = { cloudinary, configureCloudinary, isCloudinaryConfigured };
