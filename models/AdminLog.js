const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  action: {
    type: String,
    required: true,
    enum: [
      'user_restricted',
      'user_unrestricted',
      'url_restricted',
      'url_unrestricted',
      'user_updated',
      'user_deleted',
      'settings_updated',
      'system_maintenance',
      'email_sent',
      'backup_created',
      'cache_cleared',
      'report_generated',
    ],
  },
  targetType: {
    type: String,
    enum: ['user', 'url', 'qr', 'text', 'system', 'email'],
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  targetName: {
    type: String,
    default: null,
  },
  changes: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
});

// Indexes
adminLogSchema.index({ admin: 1, createdAt: -1 });
adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ targetType: 1, targetId: 1 });
adminLogSchema.index({ createdAt: -1 });

// Static method to log admin action
adminLogSchema.statics.logAction = async function(adminId, actionData) {
  const log = new this({
    admin: adminId,
    ...actionData,
  });
  
  await log.save();
  return log;
};

// Static method to get logs with pagination
adminLogSchema.statics.getLogs = async function(page = 1, limit = 50, filters = {}) {
  const skip = (page - 1) * limit;
  
  const query = this.find(filters)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('admin', 'username email')
    .lean();
  
  const total = await this.countDocuments(filters);
  const logs = await query;
  
  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// Static method to clean old logs
adminLogSchema.statics.cleanOldLogs = async function(retentionDays = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  const result = await this.deleteMany({
    createdAt: { $lt: cutoffDate },
  });
  
  return result.deletedCount;
};

const AdminLog = mongoose.model('AdminLog', adminLogSchema);

module.exports = AdminLog;