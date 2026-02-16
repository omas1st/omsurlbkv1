// utils/emailService.js
const nodemailer = require('nodemailer');
const logger = require('./logger');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SMTP_HOST = process.env.SMTP_HOST || process.env.EMAIL_HOST;
const SMTP_PORT = process.env.SMTP_PORT || process.env.EMAIL_PORT;
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER;
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_FROM || 'no-reply@example.com';
const FROM_NAME = process.env.FROM_NAME || 'Short.ly';

let transporter = null;

// Initialize transporter immediately
function initializeTransporter() {
  try {
    if (SENDGRID_API_KEY) {
      // Use SendGrid via nodemailer
      transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: 'apikey',
          pass: SENDGRID_API_KEY,
        },
        connectionTimeout: 10000, // 10 seconds
        socketTimeout: 15000, // 15 seconds
      });
      logger.info('Email service: Using SendGrid');
    } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
        connectionTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          rejectUnauthorized: false // Allow self-signed certificates
        }
      });
      logger.info(`Email service: Using SMTP (${SMTP_HOST}:${SMTP_PORT})`);
    } else {
      // Create test account synchronously for development
      logger.warn('Email service: No SMTP configuration found, using Ethereal test account');
      
      // In development, create test account immediately
      const testAccount = nodemailer.createTestAccount((err, account) => {
        if (err) {
          logger.error('Failed to create test email account:', err);
          return;
        }
        
        transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: account.user,
            pass: account.pass,
          },
          connectionTimeout: 10000,
          socketTimeout: 15000,
        });
        
        logger.info(`Email service: Using Ethereal test account: ${account.user}`);
        logger.info('Ethereal preview URL: https://ethereal.email/');
      });
    }
  } catch (error) {
    logger.error('Failed to initialize email transporter:', error);
  }
}

// Initialize on load
initializeTransporter();

function renderTemplate(templateName, context = {}) {
  const templates = {
    welcome: `Hello ${context.username || ''},

Welcome to Short.ly!

You can login here: ${context.loginUrl || ''}

Thanks,
Short.ly Team
`,
    'password-reset': `Hello ${context.username || ''},

A password reset was requested for your account. Use the link below to reset:
${context.resetUrl || ''}

This link expires in ${context.expiry || '10 minutes'}.
`,
    'password-reset-success': `Hello ${context.username || ''},

Your password was reset successfully. You can login here: ${context.loginUrl || ''}

If this wasn't you, contact support.
`,
    'contact-message': `New contact message from ${context.email || 'Anonymous'}:

${context.message || ''}

---
Received at: ${new Date().toLocaleString()}
User ID: ${context.userId || 'Not logged in'}
`,
    default: context.text || templateName || ''
  };

  return templates[templateName] || templates.default;
}

async function sendEmail({ 
  to, 
  subject = '', 
  html = null, 
  text = null, 
  template = null, 
  context = {},
  timeout = 15000 // 15 seconds timeout
} = {}) {
  try {
    // Wait for transporter to be ready (max 2 seconds)
    let waitTime = 0;
    const maxWait = 2000;
    while (!transporter && waitTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitTime += 100;
    }

    if (!transporter) {
      throw new Error('Email transporter not initialized');
    }

    const emailText = text || (template ? renderTemplate(template, context) : '');
    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject || 'Notification from Short.ly',
      text: emailText,
    };

    if (html) mailOptions.html = html;

    // Create a promise with timeout
    const sendPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Email sending timeout')), timeout);
    });

    // Race between sending and timeout
    const info = await Promise.race([sendPromise, timeoutPromise]);

    logger.info(`Email sent to ${to}: ${info.messageId}`);

    // Log ethereal preview URL in development
    if (nodemailer.getTestMessageUrl && info && process.env.NODE_ENV !== 'production') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        logger.info(`Email preview URL: ${previewUrl}`);
      }
    }

    return { success: true, info };
  } catch (err) {
    logger.error('Send email error:', err.message);
    
    // If using ethereal and failing, create a fallback log
    if (process.env.NODE_ENV !== 'production' && !SMTP_HOST) {
      logger.warn('Email not sent in development mode. In production, configure SMTP settings.');
      // Simulate success in development
      return { 
        success: true, 
        info: { messageId: 'dev-' + Date.now() },
        devMode: true 
      };
    }
    
    return { 
      success: false, 
      message: err.message,
      code: err.code
    };
  }
}

// Quick test function
async function testEmailConnection() {
  try {
    if (!transporter) {
      return { success: false, message: 'Transporter not initialized' };
    }

    const testResult = await transporter.verify();
    return { success: true, message: 'Email service is ready', details: testResult };
  } catch (error) {
    return { 
      success: false, 
      message: 'Email service test failed', 
      error: error.message 
    };
  }
}

module.exports = { 
  sendEmail, 
  renderTemplate, 
  testEmailConnection,
  isTransporterReady: () => !!transporter
};