module.exports = {
  // JWT Configuration
  JWT_EXPIRES_IN: '7d',
  JWT_REFRESH_EXPIRES_IN: '30d',
  
  // Coin System - FIXED with proper defaults
  COIN_VALUES: {
    REFERRAL_BONUS: 10,
    DAILY_LOGIN: 10,                // changed from 5 to 10
    PER_1000_VISITORS: 50,
    REGISTRATION_BONUS: 100,        // changed from 20 to 100
    QR_CUSTOMIZATION: 40,            // <-- NEW: cost for QR customization
    QR_CREATED: 5,
  },
  
  // Tier Limits
  TIER_LIMITS: {
    free: {
      maxUrls: 50,
      maxCustomAliases: 10,
      maxQRs: 20,
      maxTextPages: 10,
      analyticsRetention: '30d',
      maxFileSize: 5 * 1024 * 1024, // 5MB
    },
    premium: {
      maxUrls: 1000,
      maxCustomAliases: 500,
      maxQRs: 500,
      maxTextPages: 200,
      analyticsRetention: '1y',
      maxFileSize: 25 * 1024 * 1024, // 25MB
      features: ['advancedAnalytics', 'noAds', 'prioritySupport']
    },
    enterprise: {
      maxUrls: 10000,
      maxCustomAliases: 5000,
      maxQRs: 5000,
      maxTextPages: 1000,
      analyticsRetention: '5y',
      maxFileSize: 100 * 1024 * 1024, // 100MB
      features: ['advancedAnalytics', 'noAds', 'prioritySupport', 'customDomain', 'apiAccess', 'teamManagement']
    }
  },
  
  // Analytics
  ANALYTICS_RETENTION_DAYS: {
    free: 30,
    premium: 365,
    enterprise: 1825
  },
  
  // Rate Limits
  RATE_LIMITS: {
    free: 100, // requests per 15 minutes
    premium: 1000,
    enterprise: 10000
  },
  
  // URL Settings
  MAX_CUSTOM_ALIAS_LENGTH: 50,
  MIN_CUSTOM_ALIAS_LENGTH: 3,
  MAX_PASSWORD_LENGTH: 100,
  MAX_TAGS_PER_URL: 10,
  
  // Text Page Settings
  MAX_TEXT_LENGTH: 5000,
  MAX_TEXT_WORDS: 1000,
  MAX_REPLIES_PER_PAGE: 1000,
  
  // File Upload
  ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Security
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_RESET_EXPIRY: 10 * 60 * 1000, // 10 minutes
  
  // Email
  EMAIL_VERIFICATION_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours
  
  // Socket Events
  SOCKET_EVENTS: {
    ANALYTICS_UPDATE: 'analytics:update',
    NOTIFICATION: 'notification',
    URL_CLICK: 'url:click',
    QR_SCAN: 'qr:scan',
    TEXT_VIEW: 'text:view',
    USER_UPDATED: 'user:updated',
    URL_UPDATED: 'url:updated'
  }
};