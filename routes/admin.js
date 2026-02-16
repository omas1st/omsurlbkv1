// routes/admin.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');

// All admin routes must use protect + adminMiddleware
router.use(protect, adminMiddleware);

// User management
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.post('/users/:id/restrict', adminController.restrictUser);
router.post('/users/:id/unrestrict', adminController.unrestrictUser);

// URL management
router.get('/urls', adminController.listUrls);
router.get('/urls/:id', adminController.getUrl);
router.post('/urls/:id/restrict', adminController.restrictUrl);
router.post('/urls/:id/unrestrict', adminController.unrestrictUrl);

// Admin stats & system
router.get('/stats', adminController.getAdminStats);
router.get('/health', adminController.systemHealth);
router.get('/server-info', adminController.serverInfo);

// Settings, logs, backup, etc
router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSettings);
router.get('/logs', adminController.getLogs);
router.delete('/logs', adminController.clearLogs);
router.get('/backup', adminController.backup);
router.post('/restore', adminController.restore);
router.post('/email', adminController.sendEmail);
router.get('/email-templates', adminController.emailTemplates);
router.put('/email-templates/:id', adminController.updateEmailTemplate);
router.post('/reports', adminController.generateReport);
router.get('/reports', adminController.getReports);
router.get('/reports/:id', adminController.getReport);
router.post('/clear-cache', adminController.clearCache);
router.post('/maintenance', adminController.maintenanceMode);
router.post('/update-system', adminController.updateSystem);

module.exports = router;
