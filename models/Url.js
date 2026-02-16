const mongoose = require('mongoose');
const crypto = require('crypto');

const urlSchema = new mongoose.Schema({
  longUrl: {
    type: String,
    required: [true, 'Long URL is required'],
    trim: true,
  },
  alias: {
    type: String,
    required: [true, 'Alias is required'],
    unique: true, // This creates an index automatically
    trim: true,
    minlength: [3, 'Alias must be at least 3 characters'],
    maxlength: [50, 'Alias cannot exceed 50 characters'],
    match: [/^[a-zA-Z0-9_-]+$/, 'Alias can only contain letters, numbers, hyphens, and underscores'],
  },
  shortUrl: {
    type: String,
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  type: {
    type: String,
    enum: ['url', 'qr', 'text'],
    default: 'url',
  },
  password: {
    type: String,
    default: null,
    select: false,
  },
  passwordNote: {
    type: String,
    default: null,
    maxlength: [200, 'Password note cannot exceed 200 characters'],
  },
  analyticsPrivate: {
    type: Boolean,
    default: false,
  },
  expirationDate: {
    type: Date,
    default: null,
  },
  active: {
    type: Boolean,
    default: true,
  },
  restricted: {
    type: Boolean,
    default: false,
  },
  restrictionReason: {
    type: String,
    default: null,
  },
  customDomain: {
    type: String,
    default: null,
  },
  tags: [{
    type: String,
    trim: true,
  }],
  visitors: {
    type: Number,
    default: 0,
  },
  clicks: {
    type: Number,
    default: 0,
  },
  uniqueVisitors: {
    type: Number,
    default: 0,
  },
  todayVisitors: {
    type: Number,
    default: 0,
  },
  todayClicks: {
    type: Number,
    default: 0,
  },
  lastAccessed: {
    type: Date,
    default: null,
  },
  lastClicked: {
    type: Date,
    default: null,
  },
  metadata: {
    title: String,
    description: String,
    image: String,
    favicon: String,
    scrapedAt: Date,
  },
  customMessage: {
    type: String,
    default: null,
    maxlength: [500, 'Custom message cannot exceed 500 characters'],
  },
  utmParameters: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String,
  },
  isBulk: {
    type: Boolean,
    default: false,
  },
  bulkGroup: {
    type: String,
    default: null,
  },
  notes: {
    type: String,
    default: null,
    maxlength: [1000, 'Notes cannot exceed 1000 characters'],
  },
  scheduledActivation: {
    type: Date,
    default: null,
  },
  scheduledDeactivation: {
    type: Date,
    default: null,
  },
  // Add to existing schema fields
  scheduledRedirect: {
    enabled: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    message: { type: String, default: '', maxlength: 200 },
  },
  splashScreen: {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: '', maxlength: 60 },
    message: { type: String, default: '', maxlength: 300 },
    image: { type: String, default: '' },
    buttonText: { type: String, default: 'Continue' },
    redirectDelay: { type: Number, default: 5, min: 0, max: 30 },
    allowSkip: { type: Boolean, default: false },
    backgroundColor: { type: String, default: '#ffffff' },
    textColor: { type: String, default: '#000000' },
  },
  expiration: {
    enabled: { type: Boolean, default: false },
    expireAt: { type: Date, default: null },
    expiredRedirect: { type: String, default: '' },
  },
  multipleDestinationRules: [{
    destination: { type: String, required: true },
    conditions: [{
      field: { type: String, required: true },
      operator: { type: String, required: true },
      value: { type: String, required: true },
    }],
    priority: { type: Number, default: 0 },
  }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for analytics URL
urlSchema.virtual('analyticsUrl').get(function() {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${this.alias}/analytics`;
});

// Virtual for checking if URL is expired
urlSchema.virtual('isExpired').get(function() {
  if (!this.expirationDate) return false;
  return new Date() > this.expirationDate;
});

// Virtual for checking if URL requires password
urlSchema.virtual('passwordProtected').get(function() {
  return !!this.password;
});

// Virtual for engagement rate
urlSchema.virtual('engagementRate').get(function() {
  if (this.visitors === 0) return 0;
  return ((this.clicks / this.visitors) * 100).toFixed(2);
});

// Remove duplicate alias index - keep only other indexes
urlSchema.index({ owner: 1 });
urlSchema.index({ createdAt: -1 });
urlSchema.index({ visitors: -1 });
urlSchema.index({ clicks: -1 });
urlSchema.index({ expirationDate: 1 }, { sparse: true });
urlSchema.index({ active: 1, restricted: 1 });
urlSchema.index({ tags: 1 });
urlSchema.index({ lastAccessed: -1 });
urlSchema.index({ bulkGroup: 1 });

// FIXED: Pre-save middleware - removed the callback issue
urlSchema.pre('save', async function() {
  if (this.isModified('alias') || !this.shortUrl) {
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    this.shortUrl = `${baseUrl}/${this.alias}`;
  }
});

// Method to increment visitors
urlSchema.methods.incrementVisitors = async function(isUnique = false) {
  const today = new Date().toDateString();
  const lastAccessedDate = this.lastAccessed ? this.lastAccessed.toDateString() : null;
  
  if (lastAccessedDate !== today) {
    this.todayVisitors = 0;
    this.todayClicks = 0;
  }
  
  this.visitors += 1;
  this.todayVisitors += 1;
  
  if (isUnique) {
    this.uniqueVisitors += 1;
  }
  
  this.lastAccessed = new Date();
  await this.save({ validateBeforeSave: false });
  
  if (this.owner) {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(this.owner, {
      $inc: { totalVisitors: 1 },
      $set: { lastActive: new Date() }
    });
  }
};

// Method to increment clicks
urlSchema.methods.incrementClicks = async function() {
  const today = new Date().toDateString();
  const lastClickedDate = this.lastClicked ? this.lastClicked.toDateString() : null;
  
  if (lastClickedDate !== today) {
    this.todayClicks = 0;
  }
  
  this.clicks += 1;
  this.todayClicks += 1;
  this.lastClicked = new Date();
  await this.save({ validateBeforeSave: false });
  
  if (this.owner) {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(this.owner, {
      $inc: { totalClicks: 1 },
      $set: { lastActive: new Date() }
    });
  }
};

// Method to check password
urlSchema.methods.checkPassword = function(password) {
  if (!this.password) return true;
  
  try {
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    return this.password === hash;
  } catch (error) {
    return false;
  }
};

// Method to set password
urlSchema.methods.setPassword = function(password) {
  if (!password) {
    this.password = null;
    return;
  }
  
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  this.password = hash;
};

// Method to get status
urlSchema.methods.getStatus = function() {
  if (this.restricted) return 'restricted';
  if (!this.active) return 'paused';
  if (this.isExpired) return 'expired';
  
  const now = new Date();
  if (this.scheduledActivation && now < this.scheduledActivation) {
    return 'scheduled';
  }
  if (this.scheduledDeactivation && now > this.scheduledDeactivation) {
    return 'expired';
  }
  
  return 'active';
};

// Method to check if URL is accessible
urlSchema.methods.isAccessible = function() {
  const status = this.getStatus();
  return status === 'active';
};

// Static method to clean expired URLs
urlSchema.statics.cleanExpiredUrls = async function() {
  const expiredUrls = await this.find({
    expirationDate: { $lt: new Date() },
    active: true
  });
  
  for (const url of expiredUrls) {
    url.active = false;
    await url.save({ validateBeforeSave: false });
  }
  
  return expiredUrls.length;
};

// Static method to update scheduled URLs
urlSchema.statics.updateScheduledUrls = async function() {
  const now = new Date();
  
  await this.updateMany(
    {
      scheduledActivation: { $lte: now },
      active: false,
      restricted: false
    },
    {
      $set: { active: true },
      $unset: { scheduledActivation: 1 }
    }
  );
  
  await this.updateMany(
    {
      scheduledDeactivation: { $lte: now },
      active: true
    },
    {
      $set: { active: false },
      $unset: { scheduledDeactivation: 1 }
    }
  );
};

const Url = mongoose.model('Url', urlSchema);

module.exports = Url;