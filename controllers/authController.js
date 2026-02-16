// controllers/authController.js
const User = require('../models/User');
const Notification = require('../models/Notification');
const AdminLog = require('../models/AdminLog');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendEmail } = require('../utils/emailService');
const logger = require('../utils/logger');
const { COIN_VALUES } = require('../config/constants');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// Generate Refresh Token
const generateRefreshToken = (id) => {
  const refreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key' || process.env.JWT_SECRET;
  return jwt.sign({ id }, refreshSecret, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
};

// Verify JWT Token (helper function)
const verifyTokenHelper = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
  } catch (error) {
    return null;
  }
};

// Register user - NEVER FAIL REGISTRATION ON COIN/EMAIL/NOTIFICATION ERRORS
exports.register = async (req, res) => {
  try {
    const { username, email, password, referralCode } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] 
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email.toLowerCase() 
          ? 'Email already registered' 
          : 'Username already taken',
        field: existingUser.email === email.toLowerCase() ? 'email' : 'username',
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long',
        field: 'password',
      });
    }

    // Create user
    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
    });

    // Generate referral code
    user.generateReferralCode();

    // Handle referral if provided
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode });
      if (referrer) {
        user.referredBy = referrer._id;

        // Add coins to referrer - log error but don't fail registration
        try {
          await referrer.addCoins(COIN_VALUES.REFERRAL_BONUS || 50, 'referral_bonus');
        } catch (coinError) {
          logger.error('Referral bonus error for referrer:', coinError);
        }

        // Create notification for referrer - log error but don't fail registration
        try {
          await Notification.createNotification(referrer._id, {
            type: 'referral_joined',
            title: 'New Referral!',
            message: `${username} joined using your referral code`,
            data: { amount: COIN_VALUES.REFERRAL_BONUS || 50 },
          });
        } catch (notifError) {
          logger.error('Referral notification error:', notifError);
        }
      }
    }

    await user.save();

    // Add registration bonus - NEVER FAIL REGISTRATION
    try {
      await user.addCoins(COIN_VALUES.URL_CREATED || 50, 'registration_bonus');
    } catch (coinError) {
      logger.error('Registration bonus error:', coinError);
    }

    // Send welcome email - NEVER FAIL REGISTRATION
    try {
      await sendEmail({
        to: email,
        subject: 'Welcome to Short.ly - Your URL Shortening Platform',
        template: 'welcome',
        context: {
          username,
          loginUrl: `${process.env.FRONTEND_URL}/login`,
          dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
          referralUrl: `${process.env.FRONTEND_URL}/register?ref=${user.referralCode}`,
        },
      });
    } catch (emailError) {
      logger.error('Welcome email failed:', emailError);
    }

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Update last login - log error but don't fail registration
    try {
      await user.updateLastLogin();
    } catch (updateError) {
      logger.error('updateLastLogin error after registration:', updateError);
    }

    // Create welcome notification - NEVER FAIL REGISTRATION
    try {
      await Notification.createNotification(user._id, {
        type: 'system_announcement',
        title: 'Welcome to Short.ly!',
        message: 'Thank you for joining our platform. You have received coins as a welcome bonus!',
        important: true,
      });
    } catch (notifError) {
      logger.error('Welcome notification error:', notifError);
    }

    // Remove sensitive data from response
    const userResponse = {
      _id: user._id,
      username: user.username,
      email: user.email,
      tier: user.tier,
      coins: user.coins,
      referralCode: user.referralCode,
      isAdmin: user.isAdmin,
      profileImage: user.profileImage,
      settings: user.settings,
      createdAt: user.createdAt,
    };

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: userResponse,
      token,
      refreshToken,
    });
  } catch (error) {
    logger.error('Registration error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `This ${field} is already registered.`,
        field: field === 'email' ? 'email' : 'username',
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Login user (regular user login) - NEVER FAIL LOGIN ON COIN/NOTIFICATION ERRORS
exports.login = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

    if (!usernameOrEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username/email and password',
      });
    }

    // Find user by email or username
    const user = await User.findOne({
      $or: [
        { email: usernameOrEmail.toLowerCase() },
        { username: usernameOrEmail.toLowerCase() },
      ],
    }).select('+password +refreshToken');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if user is restricted
    if (user.isRestricted) {
      const reason = user.restrictionReason || 'Account has been restricted by administrator';
      const expires = user.restrictionExpires ? 
        `Restriction expires: ${new Date(user.restrictionExpires).toLocaleDateString()}` : 
        'Restriction is permanent';

      return res.status(403).json({
        success: false,
        message: 'Account restricted',
        reason: `${reason}. ${expires}`,
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Update last login – should not throw, but catch just in case
    try {
      await user.updateLastLogin();
    } catch (updateError) {
      logger.error('updateLastLogin error during login:', updateError);
    }

    // Add daily login bonus if it's a new day – NEVER FAIL LOGIN
    const today = new Date().toDateString();
    const lastLoginDate = user.stats.lastLoginDate ? user.stats.lastLoginDate.toDateString() : null;

    if (lastLoginDate !== today) {
      try {
        await user.addCoins(COIN_VALUES.DAILY_LOGIN || 2, 'daily_login');

        // Weekly streak bonus notification
        if (user.stats.consecutiveLogins >= 7) {
          await Notification.createNotification(user._id, {
            type: 'coin_earned',
            title: 'Weekly Streak Bonus!',
            message: `You've logged in for ${user.stats.consecutiveLogins} consecutive days!`,
            data: { amount: (COIN_VALUES.DAILY_LOGIN || 2) * 2 },
          });
        }
      } catch (coinError) {
        logger.error('Daily login bonus error:', coinError);
        // DO NOT FAIL LOGIN
      }
    }

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Create login notification – log error but don't fail login
    try {
      await Notification.createNotification(user._id, {
        type: 'login_alert',
        title: 'New Login',
        message: `Successful login from ${req.ip}`,
        important: false,
      });
    } catch (notifError) {
      logger.error('Login notification error:', notifError);
    }

    // Remove sensitive data from response
    const userResponse = {
      _id: user._id,
      username: user.username,
      email: user.email,
      tier: user.tier,
      coins: user.coins,
      isAdmin: user.isAdmin,
      profileImage: user.profileImage,
      totalUrls: user.totalUrls,
      totalVisitors: user.totalVisitors,
      totalClicks: user.totalClicks,
      settings: user.settings,
      stats: user.stats,
    };

    res.json({
      success: true,
      message: 'Login successful',
      user: userResponse,
      token,
      refreshToken,
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Admin login (separate endpoint)
exports.adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password',
      });
    }

    // Find admin user
    const user = await User.findOne({ 
      username: username.toLowerCase(),
      isAdmin: true,
    }).select('+password +refreshToken');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials',
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials',
      });
    }

    // Update last login
    await user.updateLastLogin();

    // Generate tokens
    const token = generateToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // Log admin login
    try {
      await AdminLog.logAction(user._id, {
        action: 'login',
        targetType: 'system',
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });
    } catch (logErr) {
      logger.warn('Failed to log admin login:', logErr);
    }

    res.json({
      success: true,
      message: 'Admin login successful',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        tier: user.tier,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    logger.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Admin login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Refresh token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required',
      });
    }

    const refreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key' || process.env.JWT_SECRET;
    
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, refreshSecret);

    // Find user with refresh token
    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    // Generate new tokens
    const newToken = generateToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    // Update refresh token
    user.refreshToken = newRefreshToken;
    await user.save();

    res.json({
      success: true,
      message: 'Token refreshed',
      token: newToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid refresh token',
    });
  }
};

// Forgot password
exports.forgotPassword = async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !username) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and username',
      });
    }

    // Find user
    const user = await User.findOne({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found with provided email and username',
      });
    }

    // Check if user is restricted
    if (user.isRestricted) {
      return res.status(403).json({
        success: false,
        message: 'Account is restricted. Please contact administrator.',
      });
    }

    // Generate reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request - Short.ly',
        template: 'password-reset',
        context: {
          username: user.username,
          resetUrl,
          expiry: '10 minutes',
        },
      });
    } catch (emailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      logger.error('Password reset email failed:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email',
      });
    }

    res.json({
      success: true,
      message: 'Password reset instructions sent to your email',
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process request',
    });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide reset token and new password',
      });
    }

    // Hash token
    const resetTokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid reset token
    const user = await User.findOne({
      passwordResetToken: resetTokenHash,
      passwordResetExpires: { $gt: Date.now() },
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
      });
    }

    // Check if user is restricted
    if (user.isRestricted) {
      return res.status(403).json({
        success: false,
        message: 'Account is restricted. Please contact administrator.',
      });
    }

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    // Send confirmation email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Successful - Short.ly',
        template: 'password-reset-success',
        context: {
          username: user.username,
          loginUrl: `${process.env.FRONTEND_URL}/login`,
        },
      });
    } catch (emailError) {
      logger.error('Password reset confirmation email failed:', emailError);
    }

    // Create notification
    try {
      await Notification.createNotification(user._id, {
        type: 'password_changed',
        title: 'Password Changed',
        message: 'Your password has been successfully changed',
        important: true,
      });
    } catch (notifError) {
      logger.error('Password reset notification error:', notifError);
    }

    res.json({
      success: true,
      message: 'Password reset successful',
    });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password',
    });
  }
};

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-refreshToken -passwordResetToken -passwordResetExpires -emailVerificationToken -emailVerificationExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get unread notification count
    const unreadCount = await Notification.getUnreadCount(user._id);

    // Get recent URLs
    const Url = require('../models/Url');
    const QRCode = require('../models/QRCode');
    const TextPage = require('../models/TextPage');

    const [recentUrls, recentQrs, recentTexts] = await Promise.all([
      Url.find({ owner: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('alias longUrl visitors clicks createdAt'),
      QRCode.find({ owner: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('alias destinationUrl scans lastScanned createdAt'),
      TextPage.find({ owner: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('alias textContent views lastViewed createdAt'),
    ]);

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        tier: user.tier,
        coins: user.coins,
        isAdmin: user.isAdmin,
        profileImage: user.profileImage,
        totalUrls: user.totalUrls,
        totalVisitors: user.totalVisitors,
        totalClicks: user.totalClicks,
        referralCode: user.referralCode,
        settings: user.settings,
        stats: user.stats,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
      },
      stats: {
        unreadNotifications: unreadCount,
        recentUrls: recentUrls.length,
        recentQrs: recentQrs.length,
        recentTexts: recentTexts.length,
      },
      recent: {
        urls: recentUrls,
        qrs: recentQrs,
        texts: recentTexts,
      },
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
    });
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const { username, email, settings } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const updates = {};
    const changes = {};

    // Check if username is taken
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ 
        username: username.toLowerCase(),
        _id: { $ne: user._id }
      });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken',
          field: 'username',
        });
      }
      updates.username = username.toLowerCase();
      changes.username = { from: user.username, to: username };
    }

    // Check if email is taken
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: user._id }
      });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered',
          field: 'email',
        });
      }
      updates.email = email.toLowerCase();
      updates.isVerified = false;
      changes.email = { from: user.email, to: email };
    }

    // Update settings if provided
    if (settings) {
      updates.settings = { ...user.settings.toObject(), ...settings };
      changes.settings = settings;
    }

    // Update profile image if provided
    if (req.file) {
      const { uploadImage } = require('../config/cloudinary');

      // Delete old image if exists
      if (user.profileImagePublicId) {
        const { deleteImage } = require('../config/cloudinary');
        await deleteImage(user.profileImagePublicId);
      }

      // Upload new image
      const uploadResult = await uploadImage(req.file.path, {
        folder: 'url-shortener/profile-images',
        transformation: [
          { width: 500, height: 500, crop: 'fill' },
          { quality: 'auto' },
        ],
      });

      if (uploadResult.success) {
        updates.profileImage = uploadResult.url;
        updates.profileImagePublicId = uploadResult.public_id;
        changes.profileImage = 'updated';
      }
    }

    // Update user
    Object.keys(updates).forEach(key => {
      user[key] = updates[key];
    });

    await user.save();

    // Create notification
    try {
      await Notification.createNotification(user._id, {
        type: 'profile_updated',
        title: 'Profile Updated',
        message: 'Your profile has been successfully updated',
      });
    } catch (notifError) {
      logger.error('Profile update notification error:', notifError);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        tier: user.tier,
        coins: user.coins,
        isAdmin: user.isAdmin,
        profileImage: user.profileImage,
        settings: user.settings,
      },
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
    });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password',
      });
    }

    // Validate new password
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long',
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Send email notification
    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Changed - Short.ly',
        template: 'password-changed',
        context: {
          username: user.username,
          timestamp: new Date().toLocaleString(),
          ipAddress: req.ip,
        },
      });
    } catch (emailError) {
      logger.error('Password change email failed:', emailError);
    }

    // Create notification
    try {
      await Notification.createNotification(user._id, {
        type: 'password_changed',
        title: 'Password Changed',
        message: 'Your password has been successfully changed',
        important: true,
      });
    } catch (notifError) {
      logger.error('Password change notification error:', notifError);
    }

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user) {
      user.refreshToken = undefined;
      await user.save({ validateBeforeSave: false });
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to logout',
    });
  }
};

// Verify token endpoint
exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided',
      });
    }

    const decoded = verifyTokenHelper(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.isRestricted) {
      return res.status(403).json({
        success: false,
        message: 'Account restricted',
      });
    }

    res.json({
      success: true,
      message: 'Token is valid',
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        tier: user.tier,
        coins: user.coins,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      message: 'Token verification failed',
    });
  }
};

// Simple verify endpoint for the protect middleware
exports.verify = async (req, res) => {
  try {
    // User is already verified by the protect middleware
    res.json({
      success: true,
      message: 'Token is valid',
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        tier: req.user.tier,
        coins: req.user.coins,
        isAdmin: req.user.isAdmin,
        profileImage: req.user.profileImage,
      }
    });
  } catch (error) {
    logger.error('Verify endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify token'
    });
  }
};

// Delete account
exports.deleteAccount = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.id);
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
};

// Verify email (stub function)
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    
    // This is a stub - you should implement proper email verification
    res.status(501).json({
      success: false,
      message: 'Email verification not implemented'
    });
  } catch (error) {
    logger.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify email'
    });
  }
};

// Resend verification (stub function)
exports.resendVerification = async (req, res) => {
  try {
    res.status(501).json({
      success: false,
      message: 'Resend verification not implemented'
    });
  } catch (error) {
    logger.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification'
    });
  }
};