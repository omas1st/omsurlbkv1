const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  profileImage: {
    type: String,
    default: null,
  },
  profileImagePublicId: {
    type: String,
    default: null,
  },
  tier: {
    type: String,
    enum: ['free', 'premium', 'enterprise'],
    default: 'free',
  },
  coins: {
    type: Number,
    default: 0,
    min: [0, 'Coins cannot be negative'],
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  isRestricted: {
    type: Boolean,
    default: false,
  },
  restrictionReason: {
    type: String,
    default: null,
  },
  restrictionExpires: {
    type: Date,
    default: null,
  },
  referralCode: {
    type: String,
    unique: true,
    sparse: true,
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  totalUrls: {
    type: Number,
    default: 0,
  },
  totalVisitors: {
    type: Number,
    default: 0,
  },
  totalClicks: {
    type: Number,
    default: 0,
  },
  lastLogin: {
    type: Date,
    default: null,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  loginCount: {
    type: Number,
    default: 0,
  },
  settings: {
    emailNotifications: {
      type: Boolean,
      default: true,
    },
    pushNotifications: {
      type: Boolean,
      default: true,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    language: {
      type: String,
      default: 'en',
    },
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'light',
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
  },
  stats: {
    dailyLogins: {
      type: Number,
      default: 0,
    },
    consecutiveLogins: {
      type: Number,
      default: 0,
    },
    lastLoginDate: {
      type: Date,
      default: null,
    },
  },
  refreshToken: {
    type: String,
    select: false,
  },
  passwordResetToken: {
    type: String,
    select: false,
  },
  passwordResetExpires: {
    type: Date,
    select: false,
  },
  emailVerificationToken: {
    type: String,
    select: false,
  },
  emailVerificationExpires: {
    type: Date,
    select: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for referral URL
userSchema.virtual('referralUrl').get(function() {
  return `${process.env.FRONTEND_URL}/register?ref=${this.referralCode}`;
});

// Virtual for total earnings
userSchema.virtual('totalEarnings').get(function() {
  return this.coins;
});

// Indexes
userSchema.index({ tier: 1 });
userSchema.index({ coins: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lastActive: -1 });

// Hash password before saving — promise-style middleware (no `next`)
userSchema.pre('save', async function() {
  // `this` is the document
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    // throw to reject the save operation — Mongoose will handle the rejection
    throw error;
  }
});

// Update last login timestamp
userSchema.methods.updateLastLogin = async function() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  this.lastLogin = now;
  this.lastActive = now;
  this.loginCount = (this.loginCount || 0) + 1;

  const lastLoginDate = this.stats.lastLoginDate ? new Date(this.stats.lastLoginDate) : null;

  if (lastLoginDate) {
    const lastStart = new Date(lastLoginDate);
    lastStart.setHours(0, 0, 0, 0);
    const diffDays = Math.round((todayStart - lastStart) / 86400000);

    if (diffDays === 0) {
      this.stats.dailyLogins = (this.stats.dailyLogins || 0) + 1;
    } else if (diffDays === 1) {
      this.stats.dailyLogins = 1;
      this.stats.consecutiveLogins = (this.stats.consecutiveLogins || 0) + 1;
    } else {
      this.stats.dailyLogins = 1;
      this.stats.consecutiveLogins = 1;
    }
  } else {
    this.stats.dailyLogins = 1;
    this.stats.consecutiveLogins = 1;
  }

  this.stats.lastLoginDate = now;
  return this.save({ validateBeforeSave: false });
};

// Check if password matches
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate referral code
userSchema.methods.generateReferralCode = function() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  this.referralCode = code;
  return code;
};

// Update user stats
userSchema.methods.updateStats = async function() {
  const Url = mongoose.model('Url');
  const QRCode = mongoose.model('QRCode');
  const TextPage = mongoose.model('TextPage');

  const [urls, qrs, texts] = await Promise.all([
    Url.countDocuments({ owner: this._id, active: true }),
    QRCode.countDocuments({ owner: this._id, active: true }),
    TextPage.countDocuments({ owner: this._id, active: true }),
  ]);

  this.totalUrls = urls + qrs + texts;

  const allUrls = await Url.find({ owner: this._id });
  const allQrs = await QRCode.find({ owner: this._id });
  const allTexts = await TextPage.find({ owner: this._id });

  const totalVisitors = [
    ...allUrls,
    ...allQrs,
    ...allTexts
  ].reduce((sum, item) => sum + (item.visitors || 0), 0);

  const totalClicks = [
    ...allUrls,
    ...allQrs
  ].reduce((sum, item) => sum + (item.clicks || item.scans || 0), 0);

  this.totalVisitors = totalVisitors;
  this.totalClicks = totalClicks;

  return this.save({ validateBeforeSave: false });
};

// Generate password reset token
userSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Generate email verification token
userSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return verificationToken;
};

// Add coins to user
userSchema.methods.addCoins = async function(amount, reason) {
  this.coins += amount;
  await this.save({ validateBeforeSave: false });

  const CoinTransaction = mongoose.model('CoinTransaction');
  await CoinTransaction.create({
    user: this._id,
    amount,
    type: 'earn',
    reason,
    balance: this.coins
  });

  return this.coins;
};

// Remove coins from user
userSchema.methods.removeCoins = async function(amount, reason) {
  if (this.coins < amount) {
    throw new Error('Insufficient coins');
  }

  this.coins -= amount;
  await this.save({ validateBeforeSave: false });

  const CoinTransaction = mongoose.model('CoinTransaction');
  await CoinTransaction.create({
    user: this._id,
    amount: -amount,
    type: 'spend',
    reason,
    balance: this.coins
  });

  return this.coins;
};

// Check if user can create more URLs based on tier
userSchema.methods.canCreateUrl = function(type = 'url') {
  const { TIER_LIMITS } = require('../config/constants');
  const limit = TIER_LIMITS[this.tier];

  switch(type) {
    case 'url':
      return this.totalUrls < limit.maxUrls;
    case 'qr':
      return this.totalUrls < limit.maxQRs;
    case 'text':
      return this.totalUrls < limit.maxTextPages;
    default:
      return this.totalUrls < limit.maxUrls;
  }
};

const User = mongoose.model('User', userSchema);

module.exports = User;
