// models/Notification.js
const mongoose = require('mongoose');

const { Schema } = mongoose;

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, default: 'system' }, // e.g. 'system', 'coin_earned', 'referral_joined'
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  read: { type: Boolean, default: false },
  important: { type: Boolean, default: false },
  meta: {
    ip: { type: String },
    userAgent: { type: String },
    extra: { type: Schema.Types.Mixed, default: {} },
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for quick lookups
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ read: 1 });

// Static helper to create a notification
// Usage: await Notification.createNotification(userId, { type, title, message, data, important, meta })
notificationSchema.statics.createNotification = async function(userId, payload = {}) {
  try {
    if (!userId) return null;

    const {
      type = 'system',
      title = 'Notification',
      message = '',
      data = {},
      important = false,
      meta = {}
    } = payload;

    const doc = await this.create({
      user: userId,
      type,
      title,
      message,
      data,
      important,
      meta
    });

    // Optional: emit socket event if your app provides a global emitter (safe guard)
    try {
      // If you use a global socket emitter set it on global.io or similar. This is optional.
      if (global && global.io && typeof global.io.to === 'function') {
        global.io.to(String(userId)).emit('notification', {
          id: doc._id,
          type: doc.type,
          title: doc.title,
          message: doc.message,
          data: doc.data,
          createdAt: doc.createdAt,
          important: doc.important,
        });
      }
    } catch (emitErr) {
      // don't block creation if emitting fails
      // console.warn('Notification emit failed', emitErr);
    }

    return doc;
  } catch (error) {
    // Log and rethrow or return null depending on your logging strategy
    // If you have a logger: logger.error('createNotification error:', error);
    // But to avoid breaking callers, return null
    // (Controllers that call this method should be able to handle failures gracefully)
    // If you prefer to surface errors, throw error instead.
    console.error('Notification.createNotification error:', error);
    return null;
  }
};

// IMPORTANT: do not use callback-style `next()` inside async functions.
// If you need pre('save') middleware, use promise-style (no next) or callback-style without async.
// Example promise-style pre('save') (not used here but left as reference):
// notificationSchema.pre('save', async function() {
//   // do things, throw on error to reject save
// });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
