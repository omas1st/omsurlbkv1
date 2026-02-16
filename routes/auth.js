// routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/admin/login', authController.adminLogin);

// Password reset & refresh
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/refresh', authController.refreshToken);

// Token verification endpoints
router.get('/verify', protect, authController.verify); // This uses the protect middleware
router.get('/verify-token', authController.verifyToken); // This verifies token from header

// Email verification endpoints (stubs)
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', protect, authController.resendVerification);

// Protected routes
router.get('/profile', protect, authController.getProfile);
router.post('/logout', protect, authController.logout);
router.post('/change-password', protect, authController.changePassword);
router.put('/profile', protect, authController.updateProfile);
router.delete('/account', protect, authController.deleteAccount);

module.exports = router;