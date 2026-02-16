// controllers/contactController.js
const Notification = require('../models/Notification');
const { sendEmail } = require('../utils/emailService');
const logger = require('../utils/logger');

exports.sendContactMessage = async (req, res) => {
  try {
    const { email, message } = req.body;
    const userId = req.user?._id;
    const userEmail = email || req.user?.email;

    // Basic validation
    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Message is too long (max 5000 characters)',
      });
    }

    if (email && !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address',
      });
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.error('ADMIN_EMAIL environment variable is not set');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error. Please try again later.',
      });
    }

    // Prepare email data
    const emailData = {
      to: adminEmail,
      subject: `Contact Message from ${userEmail || 'Anonymous User'}`,
      template: 'contact-message',
      context: {
        email: userEmail || 'Anonymous',
        message: message,
        userId: userId || 'Not logged in',
        timestamp: new Date().toLocaleString(),
      },
    };

    // If user provided email, set as reply-to
    if (userEmail) {
      emailData.context.replyTo = userEmail;
    }

    // Send email in the background – do NOT await it
    sendEmail(emailData)
      .then(result => {
        if (result.success) {
          logger.info(`Contact email sent to admin from ${userEmail || 'anonymous'}`);
        } else {
          logger.error('Failed to send contact email:', result);
        }
      })
      .catch(err => {
        logger.error('Unexpected error in background email sending:', err);
      });

    // Create notification for logged-in user (background, don't await)
    if (userId) {
      Notification.createNotification(userId, {
        type: 'contact_sent',
        title: 'Contact Message Sent',
        message: 'Your message has been sent to our support team.',
        important: false,
        meta: {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          extra: { email: userEmail },
        },
      }).catch(err => {
        logger.error('Failed to create notification:', err);
      });
    }

    // Log the contact message attempt
    logger.info(`Contact message processed from ${userEmail || 'anonymous'}`);

    // Respond immediately to the user
    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in sendContactMessage:', error);
    if (res.headersSent) return;
    res.status(500).json({
      success: false,
      message: 'Unable to process your message at this time. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}