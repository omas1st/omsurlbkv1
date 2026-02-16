// controllers/analyticsController.js
const Analytics = require('../models/Analytics');
const Url = require('../models/Url');
const TextPage = require('../models/TextPage'); // ADDED for text page support
const analyticsService = require('../utils/analyticsService');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// ======================
// HELPER FUNCTIONS
// ======================

/**
 * Get date range based on query parameters
 * Now properly sets start dates to midnight and end dates to end of day where appropriate.
 */
const getDateRange = (timeRange, from, to) => {
  const now = new Date();
  let startDate, endDate;

  switch (timeRange) {
    case 'today':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(); // now
      break;

    case 'yesterday':
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = new Date(yesterday);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(yesterday);
      endDate.setHours(23, 59, 59, 999);
      break;

    case 'last7days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(); // now
      break;

    case 'last30days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      break;

    case 'last60days':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 60);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      break;

    case 'lastYear':
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      break;

    case 'custom':
      startDate = from ? new Date(from) : new Date(0);
      startDate.setHours(0, 0, 0, 0);
      endDate = to ? new Date(to) : new Date();
      endDate.setHours(23, 59, 59, 999);
      break;

    default: // 'overall'
      startDate = new Date(0); // epoch
      endDate = new Date(); // now
  }

  return { startDate, endDate };
};

/**
 * Get all aliases (URLs + text pages) belonging to a user
 */
const getUserAliases = async (userId) => {
  const [urls, textPages] = await Promise.all([
    Url.find({ owner: userId }).select('alias').lean(),
    TextPage.find({ owner: userId }).select('alias').lean()
  ]);
  const urlAliases = urls.map(u => u.alias);
  const textAliases = textPages.map(t => t.alias);
  return [...urlAliases, ...textAliases];
};

// ======================
// EXISTING METHODS (KEEP)
// ======================

exports.getTimeSeries = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    const endDate = end ? new Date(end) : new Date();

    const timeSeriesData = await Analytics.find({
      alias,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 }).lean();

    const formattedData = timeSeriesData.map(item => ({
      date: item.date,
      visitors: item.data?.summary?.totalVisitors || 0,
      clicks: item.data?.summary?.totalClicks || 0,
      uniqueVisitors: item.data?.summary?.uniqueVisitors || 0
    }));

    res.json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    logger.error('getTimeSeries error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch timeseries' });
  }
};

exports.getCountries = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end, limit = 10 } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;

    const matchStage = { alias };
    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = startDate;
      if (endDate) matchStage.date.$lte = endDate;
    }

    const aggregation = await Analytics.aggregate([
      { $match: matchStage },
      { $unwind: '$data.countries' },
      {
        $group: {
          _id: {
            country: '$data.countries.country',
            countryCode: '$data.countries.countryCode',
          },
          visitors: { $sum: '$data.countries.visitors' },
        },
      },
      { $sort: { visitors: -1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          country: '$_id.country',
          countryCode: '$_id.countryCode',
          visitors: 1,
          _id: 0,
        },
      },
    ]);

    res.json({ success: true, data: aggregation });
  } catch (error) {
    logger.error('getCountries error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch countries data' });
  }
};

exports.getDevices = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;

    const matchStage = { alias };
    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = startDate;
      if (endDate) matchStage.date.$lte = endDate;
    }

    const aggregation = await Analytics.aggregate([
      { $match: matchStage },
      { $unwind: '$data.devices' },
      {
        $group: {
          _id: '$data.devices.type',
          visitors: { $sum: '$data.devices.visitors' }
        }
      },
      { $sort: { visitors: -1 } }
    ]);

    const data = aggregation.map(item => ({
      type: item._id,
      visitors: item.visitors
    }));

    res.json({ success: true, data });
  } catch (error) {
    logger.error('getDevices error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch devices data' });
  }
};

exports.getReferrers = async (req, res) => {
  try {
    const { alias } = req.params;
    const docs = await Analytics.aggregate([
      { $match: { alias } },
      { $unwind: '$data.referrers' },
      { $group: { _id: '$data.referrers.domain', visitors: { $sum: '$data.referrers.visitors' } } },
      { $sort: { visitors: -1 } },
      { $limit: 20 },
      { $project: { domain: '$_id', visitors: 1, _id: 0 } },
    ]);
    res.json({ success: true, data: docs });
  } catch (error) {
    logger.error('getReferrers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referrers' });
  }
};

exports.getBrowsers = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date(0);
    const endDate = end ? new Date(end) : new Date();

    const aggregation = await Analytics.aggregate([
      {
        $match: {
          alias,
          date: { $gte: startDate, $lte: endDate }
        }
      },
      { $unwind: '$data.browsers' },
      {
        $group: {
          _id: '$data.browsers.name',
          visitors: { $sum: '$data.browsers.visitors' }
        }
      },
      { $sort: { visitors: -1 } }
    ]);

    const data = aggregation.map(item => ({
      name: item._id,
      visitors: item.visitors
    }));

    res.json({ success: true, data });
  } catch (error) {
    logger.error('getBrowsers error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch browsers data' });
  }
};

exports.getOS = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;

    const matchStage = { alias };
    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = startDate;
      if (endDate) matchStage.date.$lte = endDate;
    }

    const aggregation = await Analytics.aggregate([
      { $match: matchStage },
      { $unwind: '$data.os' },
      {
        $group: {
          _id: '$data.os.name',
          visitors: { $sum: '$data.os.visitors' }
        }
      },
      { $sort: { visitors: -1 } }
    ]);

    const data = aggregation.map(item => ({
      name: item._id,
      visitors: item.visitors
    }));

    res.json({ success: true, data });
  } catch (error) {
    logger.error('getOS error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch OS data' });
  }
};

exports.getRealtime = async (req, res) => {
  try {
    const { alias } = req.params;
    const doc = await Analytics.findOne({ alias }).sort({ date: -1 }).lean();
    res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('getRealtime error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch realtime data' });
  }
};

/**
 * POST /api/analytics/:alias/click
 * Tracks a click for either a URL or a text page.
 */
exports.trackClick = async (req, res) => {
  try {
    const { alias } = req.params;

    // First try to find a URL
    let resource = await Url.findOne({ alias });
    let type = 'url';

    // If not found, try to find a TextPage
    if (!resource) {
      resource = await TextPage.findOne({ alias });
      if (resource) type = 'text';
    }

    if (!resource) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    let analyticsData;
    try {
      // Pass the resource (either Url or TextPage) to trackAnalytics
      analyticsData = await analyticsService.trackAnalytics(resource, req);
    } catch (trackError) {
      logger.error('Analytics tracking failed, continuing without data:', trackError);
      analyticsData = { isUnique: false };
    }

    // Increment appropriate counters
    try {
      if (type === 'url') {
        await resource.incrementVisitors(analyticsData.isUnique);
      } else {
        // For text pages, use incrementViews method
        await resource.incrementViews(analyticsData.isUnique);
      }
    } catch (incError) {
      logger.error('Failed to increment visitors:', incError);
    }

    // Emit via socket if available
    if (req.io) {
      try {
        req.io.to(`analytics:${alias}`).emit('analytics-update', {
          alias,
          type: 'click',
          data: analyticsData,
        });
      } catch (ioError) {
        logger.error('Socket emit failed:', ioError);
      }
    }

    return res.json({ success: true, data: analyticsData });

  } catch (error) {
    logger.error('Unhandled error in trackClick:', error);
    return res.status(200).json({ success: true, data: {} }); // Return 200 to avoid breaking the client
  }
};

exports.trackQRScan = async (req, res) => {
  try {
    const { alias } = req.params;
    const analyticsData = await analyticsService.trackAnalytics({ alias, type: 'qr' }, req);
    if (req.io) req.io.to(`analytics:${alias}`).emit('analytics-update', { alias, type: 'qrscan', data: analyticsData });
    res.json({ success: true, data: analyticsData });
  } catch (error) {
    logger.error('trackQRScan error:', error);
    res.status(500).json({ success: false, message: 'Failed to track qr scan' });
  }
};

exports.trackTextView = async (req, res) => {
  try {
    const { alias } = req.params;
    const analyticsData = await analyticsService.trackAnalytics({ alias, type: 'text' }, req);
    if (req.io) req.io.to(`analytics:${alias}`).emit('analytics-update', { alias, type: 'textview', data: analyticsData });
    res.json({ success: true, data: analyticsData });
  } catch (error) {
    logger.error('trackTextView error:', error);
    res.status(500).json({ success: false, message: 'Failed to track text view' });
  }
};

exports.exportData = async (req, res) => {
  try {
    const { alias } = req.params;
    const { format = 'json' } = req.query;
    const docs = await Analytics.find({ alias }).sort({ date: 1 }).lean();

    if (format === 'csv') {
      const header = 'date,totalVisitors,totalClicks,uniqueVisitors\n';
      const rows = docs.map(d => `${d.date.toISOString()},${d.data.summary.totalVisitors || 0},${d.data.summary.totalClicks || 0},${d.data.summary.uniqueVisitors || 0}`).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics-${alias}.csv"`);
      return res.send(header + rows);
    }

    res.json({ success: true, data: docs });
  } catch (error) {
    logger.error('exportData error:', error);
    res.status(500).json({ success: false, message: 'Failed to export analytics' });
  }
};

exports.getHourly = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end, timeframe, timezone } = req.query;

    const startDate = start ? new Date(start) : new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    const endDate = end ? new Date(end) : new Date();

    const matchStage = { alias, date: { $gte: startDate, $lte: endDate } };

    const aggregation = await Analytics.aggregate([
      { $match: matchStage },
      { $unwind: '$data.hourly' },
      {
        $group: {
          _id: '$data.hourly.hour',
          visitors: { $sum: '$data.hourly.visitors' },
          uniqueVisitors: { $sum: '$data.hourly.uniqueVisitors' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          hour: '$_id',
          visitors: 1,
          uniqueVisitors: 1,
          _id: 0,
        },
      },
    ]);

    const fullHours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      visitors: 0,
      uniqueVisitors: 0,
    }));
    aggregation.forEach(h => {
      const idx = fullHours.findIndex(f => f.hour === h.hour);
      if (idx !== -1) fullHours[idx] = h;
    });

    res.json({ success: true, data: fullHours });
  } catch (error) {
    logger.error('getHourly error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch hourly data' });
  }
};

exports.getHourlyMinute = async (req, res) => {
  try {
    const { alias } = req.params;
    const { hour, start, end } = req.query;
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getHourlyMinute error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch minute data' });
  }
};

exports.getLanguages = async (req, res) => {
  try {
    const { alias } = req.params;
    const { start, end, limit = 20 } = req.query;

    const startDate = start ? new Date(start) : null;
    const endDate = end ? new Date(end) : null;

    const matchStage = { alias };
    if (startDate || endDate) {
      matchStage.date = {};
      if (startDate) matchStage.date.$gte = startDate;
      if (endDate) matchStage.date.$lte = endDate;
    }

    const aggregation = await Analytics.aggregate([
      { $match: matchStage },
      { $unwind: '$data.languages' },
      {
        $group: {
          _id: {
            code: '$data.languages.code',
            name: '$data.languages.name',
          },
          visitors: { $sum: '$data.languages.visitors' },
        },
      },
      { $sort: { visitors: -1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          code: '$_id.code',
          name: '$_id.name',
          visitors: 1,
          _id: 0,
        },
      },
    ]);

    res.json({ success: true, data: aggregation });
  } catch (error) {
    logger.error('getLanguages error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch language data' });
  }
};

exports.getRecentVisitors = async (req, res) => {
  try {
    const { alias } = req.params;
    const { limit = 10 } = req.query;
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getRecentVisitors error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recent visitors' });
  }
};

exports.getSankey = async (req, res) => {
  try {
    const { alias } = req.params;
    res.json({
      success: true,
      data: {
        nodes: [],
        links: [],
      },
    });
  } catch (error) {
    logger.error('getSankey error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sankey data' });
  }
};

// ======================
// ENHANCED METHODS (with recentVisitors and full summary)
// ======================

/**
 * GET /api/analytics/overall
 * Returns aggregated analytics for all user's URLs and text pages
 */
exports.getOverall = async (req, res) => {
  try {
    const userId = req.user.id;
    const { timeframe = 'overall', from, to, timezone = 'utc' } = req.query;

    const { startDate, endDate } = getDateRange(timeframe, from, to);

    const aliases = await getUserAliases(userId);
    if (aliases.length === 0) {
      return res.json({
        success: true,
        data: {
          summary: { totalVisitors: 0, totalClicks: 0, uniqueVisitors: 0, engagementRate: 0, totalUrls: 0, avgDuration: 0, bounceRate: 0 },
          timeSeries: [],
          countries: [],
          devices: [],
          browsers: [],
          operatingSystems: [],
          referrers: [],
          languages: [],
          hourly: [],
          topUrls: [],
          recentVisitors: []
        }
      });
    }

    const matchStage = {
      alias: { $in: aliases },
      date: { $gte: startDate, $lte: endDate }
    };

    const pipeline = [
      { $match: matchStage },
      {
        $facet: {
          // 1. Summary totals (including avgDuration and bounceRate)
          summary: [
            {
              $group: {
                _id: null,
                totalVisitors: { $sum: '$data.summary.totalVisitors' },
                totalClicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' },
                avgDuration: { $avg: '$data.engagement.avgDuration' },
                bounceRate: { $avg: '$data.engagement.bounceRate' }
              }
            }
          ],

          // 2. Time series (daily)
          timeSeries: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                visitors: { $sum: '$data.summary.totalVisitors' },
                clicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' }
              }
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                date: '$_id',
                visitors: 1,
                clicks: 1,
                uniqueVisitors: 1,
                _id: 0
              }
            }
          ],

          // 3. Countries
          countries: [
            { $unwind: '$data.countries' },
            {
              $group: {
                _id: { country: '$data.countries.country', countryCode: '$data.countries.countryCode' },
                visitors: { $sum: '$data.countries.visitors' }
              }
            },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            {
              $project: {
                country: '$_id.country',
                countryCode: '$_id.countryCode',
                visitors: 1,
                _id: 0
              }
            }
          ],

          // 4. Devices
          devices: [
            { $unwind: '$data.devices' },
            {
              $group: {
                _id: '$data.devices.type',
                visitors: { $sum: '$data.devices.visitors' }
              }
            },
            { $sort: { visitors: -1 } },
            {
              $project: {
                type: '$_id',
                visitors: 1,
                _id: 0
              }
            }
          ],

          // 5. Browsers
          browsers: [
            { $unwind: '$data.browsers' },
            {
              $group: {
                _id: '$data.browsers.name',
                visitors: { $sum: '$data.browsers.visitors' }
              }
            },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            {
              $project: {
                name: '$_id',
                visitors: 1,
                _id: 0
              }
            }
          ],

          // 6. Operating Systems
          operatingSystems: [
            { $unwind: '$data.operatingSystems' },
            {
              $group: {
                _id: '$data.operatingSystems.name',
                visitors: { $sum: '$data.operatingSystems.visitors' }
              }
            },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            {
              $project: {
                name: '$_id',
                visitors: 1,
                _id: 0
              }
            }
          ],

          // 7. Referrers
          referrers: [
            { $unwind: '$data.referrers' },
            {
              $group: {
                _id: '$data.referrers.domain',
                visitors: { $sum: '$data.referrers.visitors' }
              }
            },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            {
              $project: {
                domain: '$_id',
                visitors: 1,
                _id: 0
              }
            }
          ],

          // 8. Languages
          languages: [
            { $unwind: '$data.languages' },
            {
              $group: {
                _id: { code: '$data.languages.code', name: '$data.languages.name' },
                visitors: { $sum: '$data.languages.visitors' }
              }
            },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            {
              $project: {
                code: '$_id.code',
                name: '$_id.name',
                visitors: 1,
                _id: 0
              }
            }
          ],

          // 9. Hourly distribution
          hourly: [
            { $unwind: '$data.hourly' },
            {
              $group: {
                _id: '$data.hourly.hour',
                visitors: { $sum: '$data.hourly.visitors' },
                uniqueVisitors: { $sum: '$data.hourly.uniqueVisitors' }
              }
            },
            { $sort: { _id: 1 } },
            {
              $project: {
                hour: '$_id',
                visitors: 1,
                uniqueVisitors: 1,
                _id: 0
              }
            }
          ],

          // 10. Top performing URLs
          topUrls: [
            {
              $group: {
                _id: '$alias',
                visitors: { $sum: '$data.summary.totalVisitors' },
                clicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' }
              }
            },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            {
              $lookup: {
                from: 'urls',
                localField: '_id',
                foreignField: 'alias',
                as: 'urlInfo'
              }
            },
            { $unwind: { path: '$urlInfo', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                alias: '$_id',
                longUrl: '$urlInfo.longUrl',
                shortUrl: '$urlInfo.shortUrl',
                visitors: 1,
                clicks: 1,
                uniqueVisitors: 1,
                _id: 0
              }
            }
          ],

          // 11. Recent visitors (across all URLs)
          recentVisitors: [
            { $unwind: '$data.recentVisitors' },
            { $sort: { 'data.recentVisitors.timestamp': -1 } },
            { $limit: 10 },
            {
              $project: {
                timestamp: '$data.recentVisitors.timestamp',
                country: '$data.recentVisitors.country',
                countryCode: '$data.recentVisitors.countryCode',
                city: '$data.recentVisitors.city',
                browser: '$data.recentVisitors.browser',
                os: '$data.recentVisitors.os',
                device: '$data.recentVisitors.device',
                referrer: '$data.recentVisitors.referrer',
                _id: 0
              }
            }
          ]
        }
      }
    ];

    const result = await Analytics.aggregate(pipeline);
    const data = result[0] || {};

    // Fill missing hours
    const fullHourly = Array.from({ length: 24 }, (_, i) => {
      const found = data.hourly?.find(h => h.hour === i);
      return { hour: i, visitors: found?.visitors || 0, uniqueVisitors: found?.uniqueVisitors || 0 };
    });

    let summary = data.summary?.[0] || {
      totalVisitors: 0,
      totalClicks: 0,
      uniqueVisitors: 0,
      avgDuration: 0,
      bounceRate: 0
    };
    summary.totalUrls = aliases.length;
    summary.engagementRate = summary.totalVisitors > 0
      ? ((summary.totalClicks / summary.totalVisitors) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        summary,
        timeSeries: data.timeSeries || [],
        countries: data.countries || [],
        devices: data.devices || [],
        browsers: data.browsers || [],
        operatingSystems: data.operatingSystems || [],
        referrers: data.referrers || [],
        languages: data.languages || [],
        hourly: fullHourly,
        topUrls: data.topUrls || [],
        recentVisitors: data.recentVisitors || []
      }
    });

  } catch (error) {
    logger.error('getOverall error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch overall analytics' });
  }
};

/**
 * GET /api/analytics/:alias
 * Returns aggregated analytics for a single URL or text page
 */
exports.getUrlAnalytics = async (req, res) => {
  try {
    const { alias } = req.params;
    const { timeframe = 'overall', from, to, timezone = 'utc' } = req.query;

    // Check resource existence and privacy
    let resource = await Url.findOne({ alias });
    let type = 'url';
    if (!resource) {
      resource = await TextPage.findOne({ alias });
      if (resource) type = 'text';
    }

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    // Privacy check
    if (resource.analyticsPrivate) {
      if (!req.user || (req.user.id.toString() !== resource.owner?.toString())) {
        return res.status(403).json({
          success: false,
          message: 'Analytics are private. Only the owner can view them.',
          error: 'private'
        });
      }
    }

    const { startDate, endDate } = getDateRange(timeframe, from, to);

    // First, check if any analytics documents exist for this alias in the date range
    const count = await Analytics.countDocuments({
      alias,
      date: { $gte: startDate, $lte: endDate }
    });
    logger.info(`Analytics count for /${alias}: ${count} documents in range ${startDate} to ${endDate}`);

    if (count === 0) {
      // No analytics data – return empty structure but with resource info
      const emptySummary = {
        totalVisitors: 0,
        totalClicks: 0,
        uniqueVisitors: 0,
        avgDuration: 0,
        bounceRate: 0,
        engagementRate: '0'
      };

      let resourceInfo = {
        alias: resource.alias,
        shortUrl: resource.shortUrl,
        analyticsPrivate: resource.analyticsPrivate,
        owner: resource.owner,
        createdAt: resource.createdAt,
        type
      };

      if (type === 'url') {
        resourceInfo.longUrl = resource.longUrl;
        resourceInfo.lastAccessed = resource.lastAccessed;
      } else {
        resourceInfo.wordCount = resource.metadata?.wordCount || 0;
        resourceInfo.replyCount = resource.replyCount || 0;
        resourceInfo.lastAccessed = resource.lastViewed;
      }

      return res.json({
        success: true,
        data: {
          summary: emptySummary,
          resourceInfo,
          timeSeries: [],
          countries: [],
          devices: [],
          browsers: [],
          operatingSystems: [],
          referrers: [],
          languages: [],
          hourly: Array.from({ length: 24 }, (_, i) => ({ hour: i, visitors: 0, uniqueVisitors: 0 })),
          recentVisitors: []
        }
      });
    }

    const matchStage = {
      alias,
      date: { $gte: startDate, $lte: endDate }
    };

    const pipeline = [
      { $match: matchStage },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalVisitors: { $sum: '$data.summary.totalVisitors' },
                totalClicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' },
                avgDuration: { $avg: '$data.engagement.avgDuration' },
                bounceRate: { $avg: '$data.engagement.bounceRate' }
              }
            }
          ],
          timeSeries: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                visitors: { $sum: '$data.summary.totalVisitors' },
                clicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' }
              }
            },
            { $sort: { _id: 1 } },
            { $project: { date: '$_id', visitors: 1, clicks: 1, uniqueVisitors: 1, _id: 0 } }
          ],
          countries: [
            { $unwind: '$data.countries' },
            { $group: { _id: { country: '$data.countries.country', countryCode: '$data.countries.countryCode' }, visitors: { $sum: '$data.countries.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { country: '$_id.country', countryCode: '$_id.countryCode', visitors: 1, _id: 0 } }
          ],
          devices: [
            { $unwind: '$data.devices' },
            { $group: { _id: '$data.devices.type', visitors: { $sum: '$data.devices.visitors' } } },
            { $sort: { visitors: -1 } },
            { $project: { type: '$_id', visitors: 1, _id: 0 } }
          ],
          browsers: [
            { $unwind: '$data.browsers' },
            { $group: { _id: '$data.browsers.name', visitors: { $sum: '$data.browsers.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { name: '$_id', visitors: 1, _id: 0 } }
          ],
          operatingSystems: [
            { $unwind: '$data.operatingSystems' },
            { $group: { _id: '$data.operatingSystems.name', visitors: { $sum: '$data.operatingSystems.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { name: '$_id', visitors: 1, _id: 0 } }
          ],
          referrers: [
            { $unwind: '$data.referrers' },
            { $group: { _id: '$data.referrers.domain', visitors: { $sum: '$data.referrers.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { domain: '$_id', visitors: 1, _id: 0 } }
          ],
          languages: [
            { $unwind: '$data.languages' },
            { $group: { _id: { code: '$data.languages.code', name: '$data.languages.name' }, visitors: { $sum: '$data.languages.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { code: '$_id.code', name: '$_id.name', visitors: 1, _id: 0 } }
          ],
          hourly: [
            { $unwind: '$data.hourly' },
            { $group: { _id: '$data.hourly.hour', visitors: { $sum: '$data.hourly.visitors' }, uniqueVisitors: { $sum: '$data.hourly.uniqueVisitors' } } },
            { $sort: { _id: 1 } },
            { $project: { hour: '$_id', visitors: 1, uniqueVisitors: 1, _id: 0 } }
          ],
          recentVisitors: [
            { $unwind: '$data.recentVisitors' },
            { $sort: { 'data.recentVisitors.timestamp': -1 } },
            { $limit: 10 },
            {
              $project: {
                timestamp: '$data.recentVisitors.timestamp',
                country: '$data.recentVisitors.country',
                countryCode: '$data.recentVisitors.countryCode',
                city: '$data.recentVisitors.city',
                browser: '$data.recentVisitors.browser',
                os: '$data.recentVisitors.os',
                device: '$data.recentVisitors.device',
                referrer: '$data.recentVisitors.referrer',
                _id: 0
              }
            }
          ]
        }
      }
    ];

    const result = await Analytics.aggregate(pipeline);
    const data = result[0] || {};

    // Fill missing hours
    const fullHourly = Array.from({ length: 24 }, (_, i) => {
      const found = data.hourly?.find(h => h.hour === i);
      return { hour: i, visitors: found?.visitors || 0, uniqueVisitors: found?.uniqueVisitors || 0 };
    });

    const summary = data.summary?.[0] || {
      totalVisitors: 0,
      totalClicks: 0,
      uniqueVisitors: 0,
      avgDuration: 0,
      bounceRate: 0
    };
    summary.engagementRate = summary.totalVisitors > 0
      ? ((summary.totalClicks / summary.totalVisitors) * 100).toFixed(2)
      : 0;

    // Prepare resource info
    let resourceInfo = {
      alias: resource.alias,
      shortUrl: resource.shortUrl,
      analyticsPrivate: resource.analyticsPrivate,
      owner: resource.owner,
      createdAt: resource.createdAt,
      type
    };

    if (type === 'url') {
      resourceInfo.longUrl = resource.longUrl;
      resourceInfo.lastAccessed = resource.lastAccessed;
    } else {
      resourceInfo.wordCount = resource.metadata?.wordCount || 0;
      resourceInfo.replyCount = resource.replyCount || 0;
      resourceInfo.lastAccessed = resource.lastViewed;
    }

    res.json({
      success: true,
      data: {
        summary,
        resourceInfo,
        timeSeries: data.timeSeries || [],
        countries: data.countries || [],
        devices: data.devices || [],
        browsers: data.browsers || [],
        operatingSystems: data.operatingSystems || [],
        referrers: data.referrers || [],
        languages: data.languages || [],
        hourly: fullHourly,
        recentVisitors: data.recentVisitors || []
      }
    });

  } catch (error) {
    logger.error('getUrlAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics for this resource' });
  }
};

/**
 * GET /api/analytics/:alias/public
 * Public analytics for a URL or text page – returns full aggregated data (if not private)
 */
exports.getPublicUrlAnalytics = async (req, res) => {
  try {
    const { alias } = req.params;
    const { timeframe = 'overall', from, to, timezone = 'utc' } = req.query;

    // Check resource existence
    let resource = await Url.findOne({ alias });
    let type = 'url';
    if (!resource) {
      resource = await TextPage.findOne({ alias });
      if (resource) type = 'text';
    }

    if (!resource) {
      return res.status(404).json({
        success: false,
        message: 'Resource not found'
      });
    }

    // Privacy check – if private, return 403
    if (resource.analyticsPrivate) {
      return res.status(403).json({
        success: false,
        message: 'Analytics are private for this resource',
        error: 'private'
      });
    }

    const { startDate, endDate } = getDateRange(timeframe, from, to);

    const matchStage = {
      alias,
      date: { $gte: startDate, $lte: endDate }
    };

    const pipeline = [
      { $match: matchStage },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalVisitors: { $sum: '$data.summary.totalVisitors' },
                totalClicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' },
                avgDuration: { $avg: '$data.engagement.avgDuration' },
                bounceRate: { $avg: '$data.engagement.bounceRate' }
              }
            }
          ],
          timeSeries: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                visitors: { $sum: '$data.summary.totalVisitors' },
                clicks: { $sum: '$data.summary.totalClicks' },
                uniqueVisitors: { $sum: '$data.summary.uniqueVisitors' }
              }
            },
            { $sort: { _id: 1 } },
            { $project: { date: '$_id', visitors: 1, clicks: 1, uniqueVisitors: 1, _id: 0 } }
          ],
          countries: [
            { $unwind: '$data.countries' },
            { $group: { _id: { country: '$data.countries.country', countryCode: '$data.countries.countryCode' }, visitors: { $sum: '$data.countries.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { country: '$_id.country', countryCode: '$_id.countryCode', visitors: 1, _id: 0 } }
          ],
          devices: [
            { $unwind: '$data.devices' },
            { $group: { _id: '$data.devices.type', visitors: { $sum: '$data.devices.visitors' } } },
            { $sort: { visitors: -1 } },
            { $project: { type: '$_id', visitors: 1, _id: 0 } }
          ],
          browsers: [
            { $unwind: '$data.browsers' },
            { $group: { _id: '$data.browsers.name', visitors: { $sum: '$data.browsers.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { name: '$_id', visitors: 1, _id: 0 } }
          ],
          operatingSystems: [
            { $unwind: '$data.operatingSystems' },
            { $group: { _id: '$data.operatingSystems.name', visitors: { $sum: '$data.operatingSystems.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { name: '$_id', visitors: 1, _id: 0 } }
          ],
          referrers: [
            { $unwind: '$data.referrers' },
            { $group: { _id: '$data.referrers.domain', visitors: { $sum: '$data.referrers.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { domain: '$_id', visitors: 1, _id: 0 } }
          ],
          languages: [
            { $unwind: '$data.languages' },
            { $group: { _id: { code: '$data.languages.code', name: '$data.languages.name' }, visitors: { $sum: '$data.languages.visitors' } } },
            { $sort: { visitors: -1 } },
            { $limit: 10 },
            { $project: { code: '$_id.code', name: '$_id.name', visitors: 1, _id: 0 } }
          ],
          hourly: [
            { $unwind: '$data.hourly' },
            { $group: { _id: '$data.hourly.hour', visitors: { $sum: '$data.hourly.visitors' }, uniqueVisitors: { $sum: '$data.hourly.uniqueVisitors' } } },
            { $sort: { _id: 1 } },
            { $project: { hour: '$_id', visitors: 1, uniqueVisitors: 1, _id: 0 } }
          ],
          recentVisitors: [
            { $unwind: '$data.recentVisitors' },
            { $sort: { 'data.recentVisitors.timestamp': -1 } },
            { $limit: 10 },
            {
              $project: {
                timestamp: '$data.recentVisitors.timestamp',
                country: '$data.recentVisitors.country',
                countryCode: '$data.recentVisitors.countryCode',
                city: '$data.recentVisitors.city',
                browser: '$data.recentVisitors.browser',
                os: '$data.recentVisitors.os',
                device: '$data.recentVisitors.device',
                referrer: '$data.recentVisitors.referrer',
                _id: 0
              }
            }
          ]
        }
      }
    ];

    const result = await Analytics.aggregate(pipeline);
    const data = result[0] || {};

    const fullHourly = Array.from({ length: 24 }, (_, i) => {
      const found = data.hourly?.find(h => h.hour === i);
      return { hour: i, visitors: found?.visitors || 0, uniqueVisitors: found?.uniqueVisitors || 0 };
    });

    const summary = data.summary?.[0] || {
      totalVisitors: 0,
      totalClicks: 0,
      uniqueVisitors: 0,
      avgDuration: 0,
      bounceRate: 0
    };
    summary.engagementRate = summary.totalVisitors > 0
      ? ((summary.totalClicks / summary.totalVisitors) * 100).toFixed(2)
      : 0;

    // Prepare resource info
    let resourceInfo = {
      alias: resource.alias,
      shortUrl: resource.shortUrl,
      analyticsPrivate: resource.analyticsPrivate,
      owner: resource.owner,
      createdAt: resource.createdAt,
      type
    };

    if (type === 'url') {
      resourceInfo.longUrl = resource.longUrl;
      resourceInfo.lastAccessed = resource.lastAccessed;
    } else {
      resourceInfo.wordCount = resource.metadata?.wordCount || 0;
      resourceInfo.replyCount = resource.replyCount || 0;
      resourceInfo.lastAccessed = resource.lastViewed;
    }

    res.json({
      success: true,
      data: {
        summary,
        resourceInfo,
        timeSeries: data.timeSeries || [],
        countries: data.countries || [],
        devices: data.devices || [],
        browsers: data.browsers || [],
        operatingSystems: data.operatingSystems || [],
        referrers: data.referrers || [],
        languages: data.languages || [],
        hourly: fullHourly,
        recentVisitors: data.recentVisitors || []
      }
    });

  } catch (error) {
    logger.error('getPublicUrlAnalytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch public analytics' });
  }
};