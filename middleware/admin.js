// middleware/admin.js
const User = require('../models/User');

module.exports = async function (req, res, next) {
  try {
    // protect middleware should have attached req.user
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    // If req.user is populated as full document it may contain isAdmin
    if (req.user.isAdmin) {
      return next();
    }

    // If req.user is only an id, fetch the user quickly
    const user = await User.findById(req.user.id || req.user).select('isAdmin');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    if (!user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to validate admin permissions',
    });
  }
};
