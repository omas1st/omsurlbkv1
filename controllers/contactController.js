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
        message: 'Message is required'
      });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Message is too long (max 5000 characters)'
      });
    }

    if (email && !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address'
      });
    }

    // Get admin email from environment
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      logger.error('ADMIN_EMAIL environment variable is not set');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error. Please try again later.'
      });
    }

    // Prepare email data
    const emailData = {
      to: adminEmail,
      subject: `Contact Message from ${userEmail || 'Anonymous User'}`,
      template: 'contact-message',
      context: {
        email: userEmail,
        message: message,
        userId: userId,
        timestamp: new Date().toISOString()
      },
      timeout: 10000 // 10 second timeout for email
    };

    // Try to send email with timeout
    const emailPromise = sendEmail(emailData);
    
    // Set overall timeout for the entire operation (including notification)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), 15000);
    });

    // Race between email sending and timeout
    const emailResult = await Promise.race([emailPromise, timeoutPromise]);

    // Check email result
    if (!emailResult.success) {
      logger.error('Failed to send contact email:', emailResult.message);
      
      // Don't fail the request if email fails, just log it
      // The user should still get a success response
      logger.warn('Email sending failed, but continuing with user notification...');
    } else {
      logger.info(`Contact email sent to admin from ${userEmail || 'anonymous'}`);
    }

    // Create notification for user if logged in (don't wait for it)
    if (userId) {
      Notification.createNotification(userId, {
        type: 'contact_sent',
        title: 'Contact Message Sent',
        message: 'Your message has been sent to our support team.',
        important: false,
        meta: {
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          extra: { 
            email: userEmail,
            emailSent: emailResult.success
          }
        }
      }).catch(err => {
        logger.error('Failed to create notification:', err);
      });
    }

    // Log the contact message attempt
    logger.info(`Contact message processed from ${userEmail || 'anonymous'}`);

    // Always return success to user even if email fails
    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error in sendContactMessage:', error.message);
    
    // Check if response has already been sent
    if (res.headersSent) {
      return;
    }

    // Handle specific timeout error
    if (error.message === 'Operation timeout') {
      return res.status(200).json({
        success: true,
        message: 'Message received. Our team will get back to you soon.',
        warning: 'Email confirmation may be delayed'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Unable to process your message at this time. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}