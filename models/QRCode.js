const mongoose = require('mongoose');

const qrCodeSchema = new mongoose.Schema({
  alias: {
    type: String,
    required: [true, 'Alias is required'],
    unique: true, // This creates an index automatically
    trim: true,
  },
  shortUrl: {
    type: String,
    required: true,
  },
  destinationUrl: {
    type: String,
    required: [true, 'Destination URL is required'],
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  customization: {
    qrColor: {
      type: String,
      default: '#000000',
    },
    bgColor: {
      type: String,
      default: '#FFFFFF',
    },
    includeText: {
      type: Boolean,
      default: false,
    },
    text: {
      type: String,
      default: '',
      maxlength: [100, 'Text cannot exceed 100 characters'],
    },
    textPosition: {
      type: String,
      enum: ['top', 'bottom', 'left', 'right'],
      default: 'bottom',
    },
    textColor: {
      type: String,
      default: '#000000',
    },
    textFont: {
      type: String,
      default: 'Arial',
    },
    textSize: {
      type: Number,
      default: 16,
      min: [8, 'Text size must be at least 8'],
      max: [72, 'Text size cannot exceed 72'],
    },
    logo: {
      type: String,
      default: null,
    },
    logoPublicId: {
      type: String,
      default: null,
    },
    logoSize: {
      type: Number,
      default: 40,
      min: [10, 'Logo size must be at least 10'],
      max: [100, 'Logo size cannot exceed 100'],
    },
    logoTransparent: {
      type: Boolean,
      default: false,
    },
    patternStyle: {
      type: String,
      enum: ['square', 'circle', 'rounded'],
      default: 'square',
    },
    eyeStyle: {
      type: String,
      enum: ['square', 'circle', 'rounded'],
      default: 'square',
    },
    gradient: {
      enabled: {
        type: Boolean,
        default: false,
      },
      type: {
        type: String,
        enum: ['linear', 'radial'],
        default: 'linear',
      },
      colors: [String],
      rotation: {
        type: Number,
        default: 0,
        min: 0,
        max: 360,
      },
    },
    corners: {
      type: Boolean,
      default: true,
    },
    margin: {
      type: Number,
      default: 4,
      min: 0,
      max: 20,
    },
  },
  qrImage: {
    type: String,
    required: true,
  },
  qrImagePublicId: {
    type: String,
    required: true,
  },
  qrImageUrl: {
    type: String,
    required: true,
  },
  scans: {
    type: Number,
    default: 0,
  },
  uniqueScans: {
    type: Number,
    default: 0,
  },
  todayScans: {
    type: Number,
    default: 0,
  },
  lastScanned: {
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
  tags: [{
    type: String,
    trim: true,
  }],
  metadata: {
    size: Number,
    format: String,
    errorCorrectionLevel: {
      type: String,
      enum: ['L', 'M', 'Q', 'H'],
      default: 'H',
    },
    version: Number,
    margin: Number,
  },
  analyticsPrivate: {
    type: Boolean,
    default: false,
  },
  expirationDate: {
    type: Date,
    default: null,
  },
  password: {
    type: String,
    default: null,
    select: false,
  },
  passwordNote: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for analytics URL
qrCodeSchema.virtual('analyticsUrl').get(function() {
  return `${process.env.FRONTEND_URL}/${this.alias}/analytics`;
});

// Virtual for engagement rate
qrCodeSchema.virtual('engagementRate').get(function() {
  if (this.scans === 0) return 0;
  return ((this.uniqueScans / this.scans) * 100).toFixed(2);
});

// Remove duplicate alias index
qrCodeSchema.index({ owner: 1 });
qrCodeSchema.index({ scans: -1 });
qrCodeSchema.index({ createdAt: -1 });
qrCodeSchema.index({ lastScanned: -1 });
qrCodeSchema.index({ active: 1, restricted: 1 });

// Method to increment scans
qrCodeSchema.methods.incrementScans = async function(isUnique = false) {
  const today = new Date().toDateString();
  const lastScannedDate = this.lastScanned ? this.lastScanned.toDateString() : null;
  
  if (lastScannedDate !== today) {
    this.todayScans = 0;
  }
  
  this.scans += 1;
  this.todayScans += 1;
  
  if (isUnique) {
    this.uniqueScans += 1;
  }
  
  this.lastScanned = new Date();
  await this.save({ validateBeforeSave: false });
  
  if (this.owner) {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(this.owner, {
      $inc: { totalVisitors: 1, totalClicks: 1 },
      $set: { lastActive: new Date() }
    });
  }
};

// Method to check password
qrCodeSchema.methods.checkPassword = function(password) {
  if (!this.password) return true;
  
  try {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    return this.password === hash;
  } catch (error) {
    return false;
  }
};

// Method to set password
qrCodeSchema.methods.setPassword = function(password) {
  if (!password) {
    this.password = null;
    return;
  }
  
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  this.password = hash;
};

const QRCode = mongoose.model('QRCode', qrCodeSchema);

module.exports = QRCode;