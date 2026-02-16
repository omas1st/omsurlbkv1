// routes/text.js - UPDATED
const express = require('express');
const router = express.Router();
const textController = require('../controllers/textController');
const { protect, optionalAuth } = require('../middleware/auth');

// Create text page - allow both public and authenticated users
router.post('/', optionalAuth, textController.createTextPage);

// Get all text pages for user - requires authentication
router.get('/', protect, textController.getAllTextPages);

// Get a text page by alias - public access
router.get('/:alias', optionalAuth, textController.getTextPage);

// Update a text page - requires authentication
router.put('/:id', protect, textController.updateTextPage);

// Delete a text page - requires authentication
router.delete('/:id', protect, textController.deleteTextPage);

// Replies
router.post('/:id/replies', optionalAuth, textController.addReply);
router.get('/:id/replies', protect, textController.getReplies);
router.delete('/:id/replies/:replyId', protect, textController.deleteReply);
router.patch('/:id/reply-toggle', protect, textController.toggleReply);

module.exports = router;