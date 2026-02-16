// routes/user.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect } = require('../middleware/auth');

// get profile already in auth routes, but user-specific endpoints:
router.get('/settings', protect, userController.getSettings);
router.put('/settings', protect, userController.updateSettings);
router.get('/notifications', protect, userController.getNotifications);
router.post('/notifications/mark-read', protect, userController.markNotificationsRead);
router.get('/referrals', protect, userController.getReferrals);
router.get('/activity', protect, userController.getActivity);

module.exports = router;
