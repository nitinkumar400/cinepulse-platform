const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { getEnv } = require('./env');
const logger = require('./logger');

cloudinary.config({
  cloud_name: getEnv('CLOUDINARY_CLOUD_NAME', ''),
  api_key: getEnv('CLOUDINARY_API_KEY', ''),
  api_secret: getEnv('CLOUDINARY_API_SECRET', ''),
});

const mixedStorage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'video/mp4',
      'video/x-matroska',
      'video/webm',
      'video/quicktime',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'text/vtt',
      'application/x-subrip',
      'text/plain',
    ];

    if (allowed.includes(file.mimetype) || file.fieldname === 'subtitle') {
      return cb(null, true);
    }

    return cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  },
});

function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadParams = {
      folder: options.folder || 'cinestream',
      resource_type: options.resource_type || options.type || 'auto',
      public_id: options.public_id || `file-${Date.now()}`,
    };

    if (options.format) uploadParams.format = options.format;
    if (options.transformation) uploadParams.transformation = options.transformation;
    if (options.tags) uploadParams.tags = options.tags;

    const stream = cloudinary.uploader.upload_stream(uploadParams, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });

    const timeout = setTimeout(() => {
      reject(new Error('Cloudinary upload timed out after 10 minutes'));
    }, 10 * 60 * 1000);

    stream.on('finish', () => clearTimeout(timeout));
    stream.on('error', () => clearTimeout(timeout));
    stream.end(buffer);
  });
}

async function deleteFromCloudinary(url, resourceType = 'image') {
  try {
    if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) {
      return false;
    }

    const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    if (!matches || !matches[1]) {
      logger.warn('Could not extract Cloudinary public id from URL', { url });
      return false;
    }

    const publicId = matches[1];
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    logger.info('Deleted asset from Cloudinary', { publicId, resourceType });
    return true;
  } catch (error) {
    logger.error('Cloudinary delete error', { error: error.message });
    return false;
  }
}

function getTransformedUrl(url, transformation = {}) {
  if (!url || !url.includes('cloudinary.com')) return url;
  try {
    return cloudinary.url(url, { transformation, type: 'fetch' });
  } catch {
    return url;
  }
}

module.exports = {
  cloudinary,
  mixedStorage,
  uploadToCloudinary,
  deleteFromCloudinary,
  getTransformedUrl,
};
