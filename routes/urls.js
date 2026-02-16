// routes/urls.js - Update with correct endpoints
const express = require('express');
const router = express.Router();
const urlController = require('../controllers/urlController');
const { protect, optionalAuth } = require('../middleware/auth');

// API endpoints:
// Use optionalAuth for public access to shorten URLs
router.post('/shorten', optionalAuth, urlController.shortenUrl);
router.post('/bulk', optionalAuth, urlController.bulkShorten); // CHANGED from protect to optionalAuth
router.get('/', protect, urlController.getUserUrls);
router.get('/:alias', optionalAuth, urlController.getUrl);
router.get('/:alias/stats', protect, urlController.getUrlStats);
router.put('/:id', protect, urlController.updateUrl);
router.delete('/:id', protect, urlController.deleteUrl);
router.patch('/:id/active', protect, urlController.toggleUrlActive);
router.post('/:alias/verify-password', urlController.verifyPassword);
router.get('/check-alias/:alias', urlController.checkAlias);
router.get('/:alias/export', protect, urlController.exportData);
router.get('/redirect/:alias', urlController.redirectUrl);
router.post('/:alias/evaluate-rules', optionalAuth, urlController.evaluateRules);

module.exports = router;