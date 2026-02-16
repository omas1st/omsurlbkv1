// routes/qr.js - UPDATED
const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, persistTempFileIfNeeded } = require('../middleware/upload');

// Generate QR code - allow both public and authenticated users
router.post('/generate', optionalAuth, upload.fields([{ name: 'logo', maxCount: 1 }]), persistTempFileIfNeeded, qrController.generateQR);

// Get QR code by ID - public access
router.get('/:id', optionalAuth, qrController.getQRCode);

// Get user's QR codes - requires authentication
router.get('/', protect, qrController.getUserQRCodes);

// Update QR code - requires authentication
router.put('/:id', protect, upload.fields([{ name: 'logo', maxCount: 1 }]), persistTempFileIfNeeded, qrController.updateQRCode);

// Delete QR code - requires authentication
router.delete('/:id', protect, qrController.deleteQRCode);

// Toggle QR active status - requires authentication
router.patch('/:id/toggle', protect, qrController.toggleQRActive);

// Download QR code - requires authentication
router.get('/:id/download', protect, qrController.downloadQRCode);

// Scan QR code (for tracking) - public access
router.post('/:alias/scan', qrController.scanQRCode);

module.exports = router;