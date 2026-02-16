// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

async function getUserFromToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
    if (!decoded?.id) return null;
    const user = await User.findById(decoded.id);
    return user || null;
  } catch (err) {
    return null;
  }
}

exports.protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
    if (!decoded?.id) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const user = await User.findById(decoded.id).select('-password -refreshToken -passwordResetToken -emailVerificationToken');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (user.isRestricted) {
      return res.status(403).json({ success: false, message: 'Account restricted' });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth protect error:', error);
    return res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

// Optional auth - if token exists attach user, otherwise continue
exports.optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    if (!authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
    if (!decoded?.id) return next();

    const user = await User.findById(decoded.id).select('-password -refreshToken -passwordResetToken -emailVerificationToken');
    if (!user) return next();
    if (user.isRestricted) return res.status(403).json({ success: false, message: 'Account restricted' });

    req.user = user;
    return next();
  } catch (error) {
    // don't block request — treat as unauthenticated
    return next();
  }
};
