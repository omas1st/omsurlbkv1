// routes/analytics.js - FIXED ORDER with all new analytics routes
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { protect, optionalAuth } = require('../middleware/auth');

// Overall - requires auth
router.get('/overall', protect, analyticsController.getOverall);

// Public analytics endpoint (no auth required) - must come before /:alias
router.get('/:alias/public', analyticsController.getPublicUrlAnalytics);

// ========== Protected analytics endpoints (GET, require auth) ==========
// All specific sub‑routes must be placed before the generic /:alias
router.get('/:alias/timeseries', protect, analyticsController.getTimeSeries);
router.get('/:alias/countries', protect, analyticsController.getCountries);
router.get('/:alias/devices', protect, analyticsController.getDevices);
router.get('/:alias/referrers', protect, analyticsController.getReferrers);
router.get('/:alias/browsers', protect, analyticsController.getBrowsers);
router.get('/:alias/os', protect, analyticsController.getOS);
router.get('/:alias/realtime', protect, analyticsController.getRealtime);
router.get('/:alias/hourly', protect, analyticsController.getHourly);
router.get('/:alias/hourly/minute', protect, analyticsController.getHourlyMinute);
router.get('/:alias/languages', protect, analyticsController.getLanguages);
router.get('/:alias/recent', protect, analyticsController.getRecentVisitors);
router.get('/:alias/sankey', protect, analyticsController.getSankey);
router.get('/:alias/export', protect, analyticsController.exportData);

// ========== Generic URL analytics (public with optional auth) ==========
router.get('/:alias', optionalAuth, analyticsController.getUrlAnalytics);

// ========== Tracking endpoints (public, record visits) ==========
router.post('/:alias/click', analyticsController.trackClick);
router.post('/:alias/qrscan', analyticsController.trackQRScan);
router.post('/:alias/textview', analyticsController.trackTextView);

module.exports = router;