// models/Analytics.js
const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema(
  {
    alias: {
      type: String,
      required: [true, 'Alias is required'],
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['url', 'qr', 'text'],
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    data: {
      hourly: [
        {
          hour: Number,
          visitors: Number,
          uniqueVisitors: Number,
        },
      ],

      countries: [
        {
          country: String,
          countryCode: String,
          visitors: Number,
          percentage: Number,
        },
      ],

      devices: [
        {
          // FIXED: Explicitly define the field 'type'
          type: { type: String },
          visitors: Number,
          percentage: Number,
        },
      ],

      browsers: [
        {
          name: String,
          version: String,
          visitors: Number,
          percentage: Number,
        },
      ],

      operatingSystems: [
        {
          name: String,
          version: String,
          visitors: Number,
          percentage: Number,
        },
      ],

      referrers: [
        {
          domain: String,
          url: String,
          visitors: Number,
          percentage: Number,
        },
      ],

      languages: [
        {
          code: String,
          name: String,
          visitors: Number,
          percentage: Number,
        },
      ],

      engagement: {
        bounceRate: Number,
        avgDuration: Number,
        pagesPerVisit: Number,
      },

      summary: {
        totalVisitors: Number,
        totalClicks: Number,
        uniqueVisitors: Number,
        peakHour: Number,
        bestDay: String,
        conversionRate: Number,
      },

      sessions: [String],

      // NEW: recent visitors (last 10)
      recentVisitors: [
        {
          timestamp: Date,
          country: String,
          countryCode: String,
          city: String,
          browser: String,
          os: String,
          device: String,
          referrer: String,
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
analyticsSchema.index({ alias: 1, date: 1 });
analyticsSchema.index({ owner: 1, date: -1 });
analyticsSchema.index({ type: 1, date: -1 });
analyticsSchema.index({ 'data.summary.totalVisitors': -1 });

// Static method to get analytics for time range
analyticsSchema.statics.getTimeSeries = async function(alias, startDate, endDate) {
  const match = { alias };
  if (startDate && endDate) match.date = { $gte: startDate, $lte: endDate };

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        date: { $first: '$date' },
        totalVisitors: { $sum: '$data.summary.totalVisitors' },
        totalClicks: { $sum: '$data.summary.totalClicks' },
        uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' }
      }
    },
    { $sort: { date: 1 } },
    {
      $project: {
        _id: 0,
        date: '$_id',
        totalVisitors: 1,
        totalClicks: 1,
        uniqueVisitors: 1
      }
    }
  ]);
};

// Static method to get overall analytics
analyticsSchema.statics.getOverallAnalytics = async function(owner, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        owner: mongoose.Types.ObjectId(owner),
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        totalVisitors: { $sum: '$data.summary.totalVisitors' },
        totalClicks: { $sum: '$data.summary.totalClicks' },
        totalUniqueVisitors: { $sum: '$data.summary.uniqueVisitors' },
        avgBounceRate: { $avg: '$data.engagement.bounceRate' },
        avgDuration: { $avg: '$data.engagement.avgDuration' },
        urls: { $addToSet: '$alias' },
      },
    },
    {
      $project: {
        totalVisitors: 1,
        totalClicks: 1,
        totalUniqueVisitors: 1,
        avgBounceRate: { $round: ['$avgBounceRate', 2] },
        avgDuration: { $round: ['$avgDuration', 2] },
        totalUrls: { $size: '$urls' },
        engagementRate: {
          $cond: [
            { $eq: ['$totalVisitors', 0] },
            0,
            { $round: [{ $multiply: [{ $divide: ['$totalClicks', '$totalVisitors'] }, 100] }, 2] },
          ],
        },
      },
    },
  ]);
};

// Static method to get top performing URLs
analyticsSchema.statics.getTopUrls = async function(owner, limit = 10, startDate, endDate) {
  const matchStage = {
    owner: mongoose.Types.ObjectId(owner),
  };

  if (startDate && endDate) {
    matchStage.date = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: '$alias',
        totalVisitors: { $sum: '$data.summary.totalVisitors' },
        totalClicks: { $sum: '$data.summary.totalClicks' },
        totalUniqueVisitors: { $sum: '$data.summary.uniqueVisitors' },
        lastActivity: { $max: '$date' },
      },
    },
    {
      $sort: { totalVisitors: -1 },
    },
    {
      $limit: limit,
    },
    {
      $project: {
        alias: '$_id',
        totalVisitors: 1,
        totalClicks: 1,
        totalUniqueVisitors: 1,
        lastActivity: 1,
        engagementRate: {
          $cond: [
            { $eq: ['$totalVisitors', 0] },
            0,
            { $round: [{ $multiply: [{ $divide: ['$totalClicks', '$totalVisitors'] }, 100] }, 2] },
          ],
        },
      },
    },
  ]);
};

// Static method to get countries data
analyticsSchema.statics.getCountriesData = async function(alias, startDate, endDate, limit = 10) {
  const matchStage = { alias };

  if (startDate && endDate) {
    matchStage.date = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    {
      $match: matchStage,
    },
    {
      $unwind: '$data.countries',
    },
    {
      $group: {
        _id: {
          country: '$data.countries.country',
          countryCode: '$data.countries.countryCode',
        },
        visitors: { $sum: '$data.countries.visitors' },
      },
    },
    {
      $sort: { visitors: -1 },
    },
    {
      $limit: limit,
    },
    {
      $project: {
        country: '$_id.country',
        countryCode: '$_id.countryCode',
        visitors: 1,
      },
    },
  ]);
};

// Static method to get devices data
analyticsSchema.statics.getDevicesData = async function(alias, startDate, endDate) {
  const matchStage = { alias };

  if (startDate && endDate) {
    matchStage.date = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    {
      $match: matchStage,
    },
    {
      $unwind: '$data.devices',
    },
    {
      $group: {
        _id: '$data.devices.type',
        visitors: { $sum: '$data.devices.visitors' },
      },
    },
    {
      $sort: { visitors: -1 },
    },
    {
      $project: {
        type: '$_id',
        visitors: 1,
      },
    },
  ]);
};

// Static method to get browsers data
analyticsSchema.statics.getBrowsersData = async function(alias, startDate, endDate) {
  const matchStage = { alias };

  if (startDate && endDate) {
    matchStage.date = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    {
      $match: matchStage,
    },
    {
      $unwind: '$data.browsers',
    },
    {
      $group: {
        _id: {
          name: '$data.browsers.name',
          version: '$data.browsers.version',
        },
        visitors: { $sum: '$data.browsers.visitors' },
      },
    },
    {
      $sort: { visitors: -1 },
    },
    {
      $limit: 10,
    },
    {
      $project: {
        name: '$_id.name',
        version: '$_id.version',
        visitors: 1,
      },
    },
  ]);
};

// Static method to clean old analytics data
analyticsSchema.statics.cleanOldData = async function(retentionDays = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await this.deleteMany({
    date: { $lt: cutoffDate },
  });

  return result.deletedCount;
};

const Analytics = mongoose.model('Analytics', analyticsSchema);

module.exports = Analytics;