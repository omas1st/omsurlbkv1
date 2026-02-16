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

function initializeTransporter() {
  try {
    if (SENDGRID_API_KEY) {
      transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: 'apikey',
          pass: SENDGRID_API_KEY,
        },
        connectionTimeout: 60000, // 60 seconds
        socketTimeout: 60000,
      });
      logger.info('Email service: Using SendGrid');
    } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      if (SMTP_PASS.includes(' ')) {
        logger.warn('SMTP password contains spaces. Please remove them in your .env file.');
      }

      logger.info(`SMTP configuration: host=${SMTP_HOST}, port=${SMTP_PORT}, user=${SMTP_USER}`);

      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT) || 587,
        secure: Number(SMTP_PORT) === 465, // true for 465, false for others
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
        connectionTimeout: 60000,
        socketTimeout: 60000,
        tls: {
          rejectUnauthorized: false,
        },
        debug: true,
        logger: true,
      });

      // Test connection (but don't block startup)
      transporter.verify((error, success) => {
        if (error) {
          logger.error('SMTP connection test failed:', error);
        } else {
          logger.info('SMTP connection test successful - server is ready');
        }
      });

      logger.info(`Email service: Using SMTP (${SMTP_HOST}:${SMTP_PORT})`);
    } else {
      logger.warn('Email service: No SMTP configuration found, using Ethereal test account');
      nodemailer.createTestAccount((err, account) => {
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
          connectionTimeout: 60000,
          socketTimeout: 60000,
        });
        logger.info(`Email service: Using Ethereal test account: ${account.user}`);
      });
    }
  } catch (error) {
    logger.error('Failed to initialize email transporter:', error);
  }
}

initializeTransporter();

function renderTemplate(templateName, context = {}) {
  const templates = {
    welcome: `Hello ${context.username || ''},\n\nWelcome to Short.ly!\n\nYou can login here: ${context.loginUrl || ''}\n\nThanks,\nShort.ly Team\n`,
    'password-reset': `Hello ${context.username || ''},\n\nA password reset was requested for your account. Use the link below to reset:\n${context.resetUrl || ''}\n\nThis link expires in ${context.expiry || '10 minutes'}.\n`,
    'password-reset-success': `Hello ${context.username || ''},\n\nYour password was reset successfully. You can login here: ${context.loginUrl || ''}\n\nIf this wasn't you, contact support.\n`,
    'contact-message': `New contact message from ${context.email || 'Anonymous'}:\n\n${context.message || ''}\n\n---\nReceived at: ${context.timestamp || new Date().toLocaleString()}\nUser ID: ${context.userId || 'Not logged in'}\n`,
    default: context.text || templateName || '',
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
  timeout = 60000, // 60 seconds
} = {}) {
  try {
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
    if (context.replyTo) mailOptions.replyTo = context.replyTo;

    logger.info(`Attempting to send email to ${to} with subject "${subject}"`);

    const sendPromise = transporter.sendMail(mailOptions);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Email sending timeout')), timeout)
    );

    const info = await Promise.race([sendPromise, timeoutPromise]);

    logger.info(`Email sent successfully to ${to}: ${info.messageId}`);

    if (nodemailer.getTestMessageUrl && info && process.env.NODE_ENV !== 'production') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        logger.info(`Email preview URL: ${previewUrl}`);
      }
    }

    return { success: true, info };
  } catch (err) {
    logger.error('Send email error:', err);
    // In development without SMTP, simulate success
    if (process.env.NODE_ENV !== 'production' && !SMTP_HOST) {
      logger.warn('Email not sent in development mode. In production, configure SMTP settings.');
      return { success: true, info: { messageId: 'dev-' + Date.now() }, devMode: true };
    }
    return {
      success: false,
      message: err.message,
      code: err.code,
      response: err.response,
      command: err.command,
    };
  }
}

module.exports = {
  sendEmail,
  renderTemplate,
  isTransporterReady: () => !!transporter,
};