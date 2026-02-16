// controllers/uploadController.js
const { uploadImage, generateSignature } = require('../config/cloudinary');
const logger = require('../utils/logger');

// Upload arbitrary file (uses temp file path in req.file.path)
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'File required' });

    // Upload file (req.file.path provided by persistTempFileIfNeeded middleware)
    const result = await uploadImage(req.file.path, {
      resource_type: 'auto',
      folder: 'url-shortener/uploads',
      overwrite: false,
    });

    if (!result.success) return res.status(500).json({ success: false, message: 'Upload failed' });

    res.json({ success: true, data: { url: result.url, public_id: result.public_id } });
  } catch (error) {
    logger.error('uploadFile error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload file' });
  }
};

exports.getSignature = async (req, res) => {
  try {
    const { params = {} } = req.body;
    const sig = generateSignature(params);
    res.json({ success: true, data: sig });
  } catch (error) {
    logger.error('getSignature error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate signature' });
  }
};
