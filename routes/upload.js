// routes/upload.js
const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');
const { upload, persistTempFileIfNeeded } = require('../middleware/upload');

// Single file upload route
router.post('/file', protect, upload.single('file'), persistTempFileIfNeeded, uploadController.uploadFile);

// Cloudinary signature endpoint
router.post('/cloudinary/signature', protect, uploadController.getSignature);

module.exports = router;
