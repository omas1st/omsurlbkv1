const mongoose = require('mongoose');

const coinTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  type: {
    type: String,
    enum: ['earn', 'spend', 'transfer', 'reward', 'purchase', 'refund'],
    required: true,
  },
  reason: {
    type: String,
    required: true,
  },
  metadata: {
    urlId: mongoose.Schema.Types.ObjectId,
    qrId: mongoose.Schema.Types.ObjectId,
    textPageId: mongoose.Schema.Types.ObjectId,
    referralUserId: mongoose.Schema.Types.ObjectId,
    taskId: String,
    achievementId: String,
    packageId: String,
    transactionId: String,
  },
  balance: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'completed',
  },
  notes: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes
coinTransactionSchema.index({ user: 1, createdAt: -1 });
coinTransactionSchema.index({ type: 1, createdAt: -1 });
coinTransactionSchema.index({ status: 1 });
coinTransactionSchema.index({ 'metadata.transactionId': 1 });

// Virtual for transaction description
coinTransactionSchema.virtual('description').get(function() {
  const amountPrefix = this.amount >= 0 ? '+' : '';
  return `${amountPrefix}${this.amount} coins - ${this.reason}`;
});

// Static method to get user's total earned coins
coinTransactionSchema.statics.getTotalEarned = async function(userId) {
  const result = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        type: 'earn',
        status: 'completed',
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
      },
    },
  ]);
  
  return result.length > 0 ? result[0].total : 0;
};

// Static method to get user's total spent coins
coinTransactionSchema.statics.getTotalSpent = async function(userId) {
  const result = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        type: 'spend',
        status: 'completed',
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
      },
    },
  ]);
  
  return result.length > 0 ? Math.abs(result[0].total) : 0;
};

// Static method to get daily earnings
coinTransactionSchema.statics.getDailyEarnings = async function(userId, days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        type: 'earn',
        status: 'completed',
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        date: '$_id',
        total: 1,
        count: 1,
        _id: 0,
      },
    },
  ]);
};

const CoinTransaction = mongoose.model('CoinTransaction', coinTransactionSchema);

module.exports = CoinTransaction;