// routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

// Send contact message (both authenticated and non-authenticated users)
router.post('/send', contactController.sendContactMessage);

module.exports = router;