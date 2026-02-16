const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
  alias: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['url', 'text', 'qr'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  ip: String,
  userAgent: String,
  country: String,
  countryCode: String,
  city: String,
  device: String,
  browser: String,
  os: String,
  referrer: String,
  isUnique: {
    type: Boolean,
    default: false
  },
  // optional: store language, screen size, etc.
  language: String,
  screenSize: String
});

// Index for fast recent queries per alias
visitSchema.index({ alias: 1, timestamp: -1 });

const Visit = mongoose.model('Visit', visitSchema);
module.exports = Visit;