// server.js
/* eslint-disable no-console */
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const hpp = require('hpp');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

// Load env as early as possible
dotenv.config();

// utils
const logger = require('./utils/logger');

// Import DB connect function from config (assumes config/database exports a connectDB function)
const connectDB = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const urlRoutes = require('./routes/urls');
const qrRoutes = require('./routes/qr');
const textRoutes = require('./routes/text');
const analyticsRoutes = require('./routes/analytics');
const coinRoutes = require('./routes/coins');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const userRoutes = require('./routes/user');
const contactRoutes = require('./routes/contactRoutes');

// Import middleware
const { errorHandler, notFound } = require('./middleware/error');
const { protect, optionalAuth } = require('./middleware/auth');

// Initialize express app
const app = express();

// Conditionally create HTTP server and Socket.IO only when NOT on Vercel
let server;
let io;

if (!process.env.VERCEL) {
  // Create HTTP server
  server = http.createServer(app);

  // Initialize Socket.IO
  io = new socketIo.Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : ['http://localhost:3000'],
      credentials: true
    },
    pingTimeout: 60000
  });

  // make io globally available (only if it exists)
  global.io = io;

  // Socket.io event handlers
  io.on('connection', (socket) => {
    logger.info(`New client connected: ${socket.id}`);

    socket.on('join-analytics', (alias) => {
      socket.join(`analytics:${alias}`);
      logger.info(`Socket ${socket.id} joined analytics:${alias}`);
    });

    socket.on('leave-analytics', (alias) => {
      socket.leave(`analytics:${alias}`);
      logger.info(`Socket ${socket.id} left analytics:${alias}`);
    });

    socket.on('join-notifications', (userId) => {
      socket.join(`notifications:${userId}`);
      logger.info(`Socket ${socket.id} joined notifications:${userId}`);
    });

    // ✅ New: Subscribe to real-time text page replies
    socket.on('subscribe_text_replies', ({ textId }) => {
      if (!textId) return;
      socket.join(`text:${textId}`);
      logger.info(`Socket ${socket.id} subscribed to text replies for ${textId}`);
    });

    // ✅ New: Unsubscribe from text page replies
    socket.on('unsubscribe_text_replies', ({ textId }) => {
      if (!textId) return;
      socket.leave(`text:${textId}`);
      logger.info(`Socket ${socket.id} unsubscribed from text replies for ${textId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Client disconnected: ${socket.id} - ${reason}`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error: ${error}`);
    });
  });
} else {
  // On Vercel, no persistent server or socket.io
  global.io = null;
}

// Middleware to attach io to request object (works even if io is null)
app.use((req, res, next) => {
  req.io = global.io;
  next();
});

// ======================
// DATABASE CONNECTION MIDDLEWARE (for Vercel serverless)
// ======================
// Ensures MongoDB is connected before any route handler runs.
// This runs on every request but connectDB() is idempotent.
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    try {
      await connectDB();
      logger.info('Database connected via request middleware');
    } catch (err) {
      logger.error(`Database connection failed: ${err.message}`);
      return res.status(500).json({ error: 'Database connection error' });
    }
  }
  next();
});

// ----------------------
// Basic security / performance middleware
// ----------------------
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom XSS protection middleware (replaces xss-clean)
app.use((req, res, next) => {
  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  
  next();
});

// Helper function to recursively sanitize objects
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return;
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        obj[key] = xss(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  }
}

// Prevent HTTP Parameter Pollution
app.use(hpp());

// Compression
app.use(compression());

// Rate limiting (apply to API routes)
const limiter = rateLimit({
  windowMs: +(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: +(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// ----------------------
// Safe sanitizer middleware (for MongoDB injection prevention)
// ----------------------
function sanitizeForMongo(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForMongo);

  const clean = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    const value = obj[key];
    clean[key] = (typeof value === 'object' && value !== null) ? sanitizeForMongo(value) : value;
  }
  return clean;
}

app.use((req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeForMongo(req.body);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeForMongo(req.params);
    }
  } catch (err) {
    logger.error(`Sanitizer middleware error: ${err.message}`);
  }
  next();
});

// ----------------------
// Request logging
// ----------------------
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url} - ${req.ip}`);
  next();
});

// ----------------------
// Health check
// ----------------------
app.get('/health', (req, res) => {
  const statusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: {
      status: statusMap[mongoose.connection.readyState] || 'unknown',
      readyState: mongoose.connection.readyState
    }
  });
});

// ----------------------
// Root route - Welcome page
// ----------------------
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to URL Shortener API',
    version: '1.0.0',
    documentation: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/api-docs` : 'http://localhost:3000/api-docs',
    endpoints: {
      auth: '/api/auth',
      urls: '/api/urls',
      analytics: '/api/analytics',
      qr: '/api/qr',
      text: '/api/text',
      coins: '/api/coins',
      admin: '/api/admin',
      upload: '/api/upload',
      user: '/api/user',
      contact: '/api/contact'
    }
  });
});

// ----------------------
// API Base Route
// ----------------------
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API Base Endpoint',
    version: '1.0.0',
    available_endpoints: {
      auth: {
        login: 'POST /api/auth/login',
        register: 'POST /api/auth/register',
        logout: 'POST /api/auth/logout',
        refresh: 'POST /api/auth/refresh',
        verify: 'POST /api/auth/verify',
        forgot_password: 'POST /api/auth/forgot-password',
        reset_password: 'POST /api/auth/reset-password'
      },
      urls: {
        create: 'POST /api/urls',
        list: 'GET /api/urls',
        get: 'GET /api/urls/:id',
        update: 'PUT /api/api/urls/:id',
        delete: 'DELETE /api/urls/:id',
        stats: 'GET /api/urls/:id/stats',
        bulk: 'POST /api/urls/bulk'
      },
      qr: {
        create: 'POST /api/qr',
        list: 'GET /api/qr',
        get: 'GET /api/qr/:id',
        update: 'PUT /api/qr/:id',
        delete: 'DELETE /api/qr/:id',
        download: 'GET /api/qr/:id/download'
      },
      text: {
        create: 'POST /api/text',
        list: 'GET /api/text',
        get: 'GET /api/text/:id',
        update: 'PUT /api/text/:id',
        delete: 'DELETE /api/text/:id',
        add_reply: 'POST /api/text/:id/reply'
      },
      analytics: {
        overall: 'GET /api/analytics',
        url_stats: 'GET /api/analytics/url/:alias',
        time_series: 'GET /api/analytics/url/:alias/timeseries',
        countries: 'GET /api/analytics/url/:alias/countries',
        devices: 'GET /api/analytics/url/:alias/devices'
      },
      coins: {
        balance: 'GET /api/coins/balance',
        transactions: 'GET /api/coins/transactions',
        earn: 'POST /api/coins/earn',
        spend: 'POST /api/coins/spend'
      },
      admin: {
        users: 'GET /api/admin/users',
        urls: 'GET /api/admin/urls',
        stats: 'GET /api/admin/stats',
        restrict: 'POST /api/admin/restrict',
        unrestrict: 'POST /api/admin/unrestrict'
      },
      upload: {
        image: 'POST /api/upload/image',
        file: 'POST /api/upload/file',
        delete: 'DELETE /api/upload/:publicId'
      },
      user: {
        profile: 'GET /api/user/profile',
        update: 'PUT /api/user/profile',
        change_password: 'PUT /api/user/change-password',
        notifications: 'GET /api/user/notifications',
        mark_notifications_read: 'PUT /api/user/notifications/read'
      },
      contact: {
        send_message: 'POST /api/contact/send'
      }
    }
  });
});

// ----------------------
// Favicon route - return 204 No Content
// ----------------------
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// ----------------------
// API Routes (with /api prefix) - MUST COME FIRST
// ----------------------
app.use('/api/auth', authRoutes);
app.use('/api/urls', urlRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/text', textRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/coins', coinRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/user', userRoutes);
app.use('/api/contact', contactRoutes);

// ----------------------
// Direct Routes (without /api prefix for compatibility)
// ----------------------
app.use('/auth', authRoutes);
app.use('/urls', urlRoutes);
app.use('/qr', qrRoutes);
app.use('/text', textRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/coins', coinRoutes);
app.use('/admin', adminRoutes);
app.use('/upload', uploadRoutes);
app.use('/user', userRoutes);
app.use('/contact', contactRoutes);

// ----------------------
// SHORT URL REDIRECT ROUTE - MODIFIED TO TRACK VISITS FOR BROWSER REQUESTS
// ----------------------
app.get('/:alias', async (req, res, next) => {
  // Skip if it's a known API or static file path
  const skipPaths = [
    'api', 'auth', 'urls', 'qr', 'text', 'analytics', 'coins', 'admin', 
    'upload', 'user', 'favicon.ico', 'robots.txt', 'sitemap.xml', 
    'manifest.json', 'logo', 'static', 'assets', 'contact'
  ];
  
  const alias = req.params.alias;
  
  if (skipPaths.some(path => req.path.startsWith(`/${path}`) || alias === path)) {
    return next();
  }
  
  if (alias.includes('.')) {
    return next();
  }

  try {
    // Dynamically require models and service to avoid circular dependency
    const Url = require('./models/Url');
    const TextPage = require('./models/TextPage');
    const analyticsService = require('./utils/analyticsService');

    // Find the resource (URL or TextPage)
    let resource = await Url.findOne({ alias }).select('+password');
    let type = 'url';
    if (!resource) {
      resource = await TextPage.findOne({ alias }).select('+password');
      type = 'text';
    }

    // If resource doesn't exist, pass to frontend (it will show 404)
    if (!resource) {
      return next();
    }

    // --- TRACK THE VISIT ---
    // This is the missing piece that counts every hit to the short URL
    let analyticsData = null;
    try {
      analyticsData = await analyticsService.trackAnalytics(resource, req);
      
      // Update the resource's visitor counters
      if (type === 'url') {
        await resource.incrementVisitors(analyticsData.isUnique);
      } else if (type === 'text') {
        // For text pages, use their own view increment method
        if (typeof resource.incrementViews === 'function') {
          await resource.incrementViews(analyticsData.isUnique);
        }
      }
      
      // Mark that we have already tracked this request so downstream controllers don't double-count
      req.tracked = true;
    } catch (trackError) {
      console.error('Analytics tracking error in /:alias route:', trackError);
      // Continue even if tracking fails
    }

    // --- DECIDE WHAT TO DO NEXT ---
    const acceptHTML = req.headers.accept && req.headers.accept.includes('text/html');

    // Determine if this resource requires frontend UI (password, splash, rules, etc.)
    let requiresUI = false;
    if (type === 'url') {
      requiresUI = 
        !resource.active ||
        resource.restricted ||
        (resource.expirationDate && new Date() > resource.expirationDate) ||
        resource.passwordProtected ||
        (resource.splashScreen && resource.splashScreen.enabled) ||
        (resource.multipleDestinationRules && resource.multipleDestinationRules.length > 0);
    } else { // text page
      requiresUI = 
        !resource.active ||
        resource.restricted ||
        (resource.expirationDate && new Date() > resource.expirationDate) ||
        resource.passwordProtected;
    }

    // For browser requests that need frontend UI → let React handle it
    if (acceptHTML && requiresUI) {
      return next();
    }

    // For non-browser requests (API, QR scanners) or resources that can be redirected immediately:
    if (type === 'url') {
      const urlController = require('./controllers/urlController');
      // Call redirectUrl; it will check req.tracked and skip duplicate tracking
      return urlController.redirectUrl(req, res, next);
    } else {
      // For text pages without UI requirements, you could serve the page directly.
      // Since you haven't provided textController, we pass to next() and let frontend handle it.
      return next();
    }
  } catch (error) {
    console.error('Error in /:alias route:', error);
    next();
  }
});

// ----------------------
// 404 handler
// ----------------------
app.use(notFound);

// ----------------------
// Error handler
// ----------------------
app.use(errorHandler);

// ----------------------
// DB connect and server start (only when NOT on Vercel)
// ----------------------
if (!process.env.VERCEL) {
  (async () => {
    try {
      if (typeof connectDB === 'function') {
        await connectDB();
      } else {
        logger.warn('connectDB is not a function. Check config/database export.');
      }
    } catch (err) {
      logger.error(`Initial DB connection attempt failed: ${err.message}`);
    }

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`Frontend URL: ${process.env.FRONTEND_URL}`);
    });
  })();
}

// ----------------------
// Process-level error handlers – PREVENT SERVER HANGING
// ----------------------
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Give logger time to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  if (server) {
    server.close(() => {
      mongoose.connection.close(false, () => {
        logger.info('MongoDB connection closed.');
        process.exit(0);
      });
    });
  } else {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  if (server) {
    server.close(() => {
      mongoose.connection.close(false, () => {
        logger.info('MongoDB connection closed.');
        process.exit(0);
      });
    });
  } else {
    mongoose.connection.close(false, () => {
      process.exit(0);
    });
  }
});

// ----------------------
// Export the Express app for Vercel serverless
// ----------------------
module.exports = app;