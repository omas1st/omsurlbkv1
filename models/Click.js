const mongoose = require('mongoose');
const UAParser = require('ua-parser-js');

const clickSchema = new mongoose.Schema({
  urlId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Url',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sessionId: {
    type: String,
    index: true
  },
  // Geographic data
  ipAddress: {
    type: String,
    required: true,
    index: true
  },
  country: {
    type: String,
    index: true
  },
  city: {
    type: String
  },
  region: {
    type: String
  },
  latitude: {
    type: Number
  },
  longitude: {
    type: Number
  },
  // Device data
  device: {
    type: String,
    enum: ['desktop', 'mobile', 'tablet', 'bot', 'other'],
    default: 'other'
  },
  deviceModel: {
    type: String
  },
  deviceVendor: {
    type: String
  },
  // Browser data
  browser: {
    type: String
  },
  browserVersion: {
    type: String
  },
  engine: {
    type: String
  },
  engineVersion: {
    type: String
  },
  // OS data
  os: {
    type: String
  },
  osVersion: {
    type: String
  },
  cpu: {
    type: String
  },
  // Screen data
  screenResolution: {
    width: Number,
    height: Number
  },
  viewportSize: {
    width: Number,
    height: Number
  },
  colorDepth: {
    type: Number
  },
  pixelRatio: {
    type: Number
  },
  // Network data
  connectionType: {
    type: String
  },
  effectiveType: {
    type: String
  },
  downlink: {
    type: Number
  },
  rtt: {
    type: Number
  },
  // Referrer data
  referrer: {
    type: String
  },
  referrerDomain: {
    type: String,
    index: true
  },
  medium: {
    type: String,
    enum: ['direct', 'organic', 'social', 'email', 'paid', 'referral', 'other'],
    default: 'direct'
  },
  source: {
    type: String
  },
  campaign: {
    type: String
  },
  term: {
    type: String
  },
  content: {
    type: String
  },
  // User behavior
  isReturning: {
    type: Boolean,
    default: false
  },
  timeOnPage: {
    type: Number
  },
  scrollDepth: {
    type: Number
  },
  clicksOnPage: {
    type: Number
  },
  // Conversion data
  isConversion: {
    type: Boolean,
    default: false
  },
  conversionValue: {
    type: Number
  },
  conversionCategory: {
    type: String
  },
  // Timing data
  timeToClick: {
    type: Number
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  // Additional metadata
  userAgent: {
    type: String
  },
  language: {
    type: String
  },
  timezone: {
    type: String
  },
  // Custom data
  customData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Affiliate data
  affiliateId: {
    type: String
  },
  affiliateTag: {
    type: String
  },
  // Bot detection
  isBot: {
    type: Boolean,
    default: false
  },
  botName: {
    type: String
  }
}, {
  timestamps: true
});

// Compound indexes for common queries
clickSchema.index({ urlId: 1, timestamp: -1 });
clickSchema.index({ country: 1, timestamp: -1 });
clickSchema.index({ device: 1, timestamp: -1 });
clickSchema.index({ referrerDomain: 1, timestamp: -1 });
clickSchema.index({ isConversion: 1, timestamp: -1 });
clickSchema.index({ userId: 1, timestamp: -1 });

// Pre-save middleware to parse user agent and referrer
clickSchema.pre('save', async function() {
  if (this.userAgent && (!this.browser || !this.os)) {
    try {
      const parser = new UAParser(this.userAgent);
      const result = parser.getResult();
      this.browser = result.browser.name;
      this.browserVersion = result.browser.version;
      this.os = result.os.name;
      this.osVersion = result.os.version;
      this.deviceModel = result.device.model;
      this.deviceVendor = result.device.vendor;
      this.engine = result.engine.name;
      this.engineVersion = result.engine.version;
      this.cpu = result.cpu.architecture;

      // Determine device type
      if (result.device && result.device.type === 'mobile') {
        this.device = 'mobile';
      } else if (result.device && result.device.type === 'tablet') {
        this.device = 'tablet';
      } else if (result.device && result.device.type === 'desktop') {
        this.device = 'desktop';
      } else if (result.device && result.device.type) {
        this.device = result.device.type;
      }

      // Detect bots
      const botPatterns = [
        /bot/i, /crawler/i, /spider/i, /scraper/i,
        /curl/i, /wget/i, /python/i, /java/i,
        /google/i, /bing/i, /yahoo/i, /duckduckgo/i,
        /baidu/i, /yandex/i, /facebook/i, /twitter/i
      ];
      this.isBot = botPatterns.some(pattern => pattern.test(this.userAgent));
      if (this.isBot) {
        const split = this.userAgent.split('/');
        this.botName = split && split[0] ? split[0] : this.userAgent;
      }
    } catch (err) {
      console.error('UA parsing error in click pre-save:', err);
    }
  }

  // Extract referrer domain
  if (this.referrer && !this.referrerDomain && this.referrer !== 'Direct') {
    try {
      const url = new URL(this.referrer);
      this.referrerDomain = url.hostname;
      // Determine medium
      const socialDomains = [
        'facebook.com', 'twitter.com', 'instagram.com',
        'linkedin.com', 'pinterest.com', 'tiktok.com',
        'youtube.com', 'reddit.com'
      ];
      const searchEngines = [
        'google.com', 'bing.com', 'yahoo.com',
        'duckduckgo.com', 'baidu.com', 'yandex.com'
      ];
      if (socialDomains.some(domain => url.hostname.includes(domain))) {
        this.medium = 'social';
      } else if (searchEngines.some(domain => url.hostname.includes(domain))) {
        this.medium = 'organic';
      } else {
        this.medium = 'referral';
      }
    } catch (error) {
      this.referrerDomain = 'invalid';
      this.medium = 'other';
    }
  }

  // Set default medium if not set
  if (!this.medium) {
    this.medium = this.referrer && this.referrer !== 'Direct' ? 'referral' : 'direct';
  }
});

const Click = mongoose.model('Click', clickSchema);
module.exports = Click;