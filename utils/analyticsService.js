// utils/analyticsService.js
const geoip = require('geoip-lite');
const useragent = require('useragent');
const UAParser = require('ua-parser-js');
const Analytics = require('../models/Analytics');
const accepts = require('accepts');
const logger = require('./logger'); // optional, but good to use logger

// Helper: extract primary language from Accept-Language header
const getPrimaryLanguage = (acceptLanguageHeader) => {
  if (!acceptLanguageHeader || typeof acceptLanguageHeader !== 'string') {
    return { code: 'unknown', name: 'Unknown' };
  }
  try {
    const accept = accepts({ headers: { 'accept-language': acceptLanguageHeader } });
    const lang = accept.language();
    let code = 'unknown';
    let name = 'Unknown';

    if (lang && typeof lang === 'string') {
      code = lang.split('-')[0] || 'unknown';
      try {
        const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
        name = languageNames.of(code) || 'Unknown';
      } catch {
        name = code.toUpperCase();
      }
    }
    return { code, name };
  } catch (error) {
    console.error('Language parsing error:', error);
    return { code: 'unknown', name: 'Unknown' };
  }
};

// Track analytics data
exports.trackAnalytics = async (url, req) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // --- IP & GEO ---
    const ip =
      req.headers['x-forwarded-for'] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      '';
    let geo = {};
    try {
      geo = geoip.lookup(ip) || {};
    } catch (geoError) {
      console.error('GeoIP lookup error:', geoError);
    }

    // --- User Agent ---
    let agent, ua;
    try {
      agent = useragent.parse(req.headers['user-agent'] || '');
      ua = new UAParser(req.headers['user-agent'] || '').getResult();
    } catch (uaError) {
      console.error('User agent parsing error:', uaError);
      agent = { family: 'Unknown', major: '' };
      ua = { browser: {}, os: {}, device: {} };
    }

    // --- Language ---
    const { code: langCode, name: langName } = getPrimaryLanguage(
      req.headers['accept-language']
    );

    // --- Unique session check ---
    const sessionKey = `${ip}-${req.headers['user-agent'] || ''}`;
    const sessionHash = require('crypto')
      .createHash('md5')
      .update(sessionKey)
      .digest('hex');

    const existingSession = await Analytics.findOne({
      alias: url.alias,
      date: today,
      'data.sessions': sessionHash,
    });

    const isUnique = !existingSession;

    // --- Assemble analytics payload ---
    const analyticsData = {
      ip: ip || 'Unknown',
      country: geo.country || 'Unknown',
      countryCode: geo.country || 'XX',
      city: geo.city || 'Unknown',
      region: geo.region || 'Unknown',
      timezone: geo.timezone || 'UTC',
      browser: ua.browser.name || agent.family || 'Unknown',
      browserVersion: ua.browser.version || agent.major || '',
      os: ua.os.name || agent.os?.family || 'Unknown',
      osVersion: ua.os.version || agent.os?.major || '',
      device: ua.device.type || 'desktop',
      deviceModel: ua.device.model || 'Unknown',
      referrer: req.headers.referer || req.headers.referrer || 'Direct',
      timestamp: now,
      isUnique,
      sessionHash,
      language: langCode,
      languageName: langName,
    };

    // --- Save to Analytics collection ---
    await saveAnalytics(url, analyticsData, today);

    return analyticsData;
  } catch (error) {
    console.error('Track analytics error:', error);
    // Return a minimal default so the calling function can proceed
    return {
      ip: 'Unknown',
      country: 'Unknown',
      countryCode: 'XX',
      city: 'Unknown',
      browser: 'Unknown',
      os: 'Unknown',
      device: 'desktop',
      referrer: 'Direct',
      isUnique: true,
      language: 'unknown',
      languageName: 'Unknown',
    };
  }
};

// Save analytics to database
const saveAnalytics = async (url, data, date) => {
  try {
    let analytics = await Analytics.findOne({
      alias: url.alias,
      date,
    });

    if (!analytics) {
      analytics = new Analytics({
        alias: url.alias,
        date,
        type: url.type || 'url',
        owner: url.owner || null,
        data: {
          hourly: Array(24)
            .fill()
            .map((_, hour) => ({
              hour,
              visitors: 0,
              clicks: 0,
              uniqueVisitors: 0,
            })),
          countries: [],
          devices: [],
          browsers: [],
          operatingSystems: [],
          referrers: [],
          languages: [],
          engagement: {
            bounceRate: 0,
            avgDuration: 0,
            pagesPerVisit: 1,
          },
          summary: {
            totalVisitors: 0,
            totalClicks: 0,
            uniqueVisitors: 0,
            peakHour: 0,
            bestDay: new Date().toLocaleDateString('en-US', {
              weekday: 'long',
            }),
            conversionRate: 0,
          },
          sessions: [],
          recentVisitors: [], // <-- ADDED: initialize recent visitors array
        },
      });
    }

    const hour = new Date().getHours();

    // --- UPDATE SUMMARY TOTALS ---
    analytics.data.summary.totalVisitors += 1;
    analytics.data.summary.totalClicks += 1; // <-- ADDED: increment clicks
    if (data.isUnique) analytics.data.summary.uniqueVisitors += 1;

    // --- Update hourly ---
    analytics.data.hourly[hour].visitors += 1;
    if (data.isUnique) analytics.data.hourly[hour].uniqueVisitors += 1;

    // --- Country ---
    const countryIdx = analytics.data.countries.findIndex(
      (c) => c.countryCode === data.countryCode
    );
    if (countryIdx >= 0) analytics.data.countries[countryIdx].visitors += 1;
    else
      analytics.data.countries.push({
        country: data.country,
        countryCode: data.countryCode,
        visitors: 1,
        percentage: 0,
      });

    // --- Device ---
    const deviceIdx = analytics.data.devices.findIndex(
      (d) => d.type === data.device
    );
    if (deviceIdx >= 0) analytics.data.devices[deviceIdx].visitors += 1;
    else
      analytics.data.devices.push({
        type: data.device,
        visitors: 1,
        percentage: 0,
      });

    // --- Browser ---
    const browserIdx = analytics.data.browsers.findIndex(
      (b) => b.name === data.browser
    );
    if (browserIdx >= 0) analytics.data.browsers[browserIdx].visitors += 1;
    else
      analytics.data.browsers.push({
        name: data.browser,
        version: data.browserVersion,
        visitors: 1,
        percentage: 0,
      });

    // --- OS ---
    const osIdx = analytics.data.operatingSystems.findIndex(
      (o) => o.name === data.os
    );
    if (osIdx >= 0) analytics.data.operatingSystems[osIdx].visitors += 1;
    else
      analytics.data.operatingSystems.push({
        name: data.os,
        version: data.osVersion,
        visitors: 1,
        percentage: 0,
      });

    // --- Referrer ---
    let domain = 'Direct';
    if (data.referrer !== 'Direct' && data.referrer) {
      try {
        domain = new URL(data.referrer).hostname;
      } catch {
        domain = data.referrer;
      }
    }
    const refIdx = analytics.data.referrers.findIndex((r) => r.domain === domain);
    if (refIdx >= 0) analytics.data.referrers[refIdx].visitors += 1;
    else
      analytics.data.referrers.push({
        domain,
        url: data.referrer,
        visitors: 1,
        percentage: 0,
      });

    // --- Language ---
    const langIdx = analytics.data.languages.findIndex(
      (l) => l.code === data.language
    );
    if (langIdx >= 0) analytics.data.languages[langIdx].visitors += 1;
    else
      analytics.data.languages.push({
        code: data.language,
        name: data.languageName,
        visitors: 1,
        percentage: 0,
      });

    // --- Session ---
    if (!analytics.data.sessions.includes(data.sessionHash)) {
      analytics.data.sessions.push(data.sessionHash);
    }

    // --- RECENT VISITORS ---
    analytics.data.recentVisitors.push({
      timestamp: data.timestamp,
      country: data.country,
      countryCode: data.countryCode,
      city: data.city,
      browser: data.browser,
      os: data.os,
      device: data.device,
      referrer: data.referrer,
    });
    // Keep only last 10
    if (analytics.data.recentVisitors.length > 10) {
      analytics.data.recentVisitors = analytics.data.recentVisitors.slice(-10);
    }

    // --- Recalculate percentages ---
    const total = analytics.data.summary.totalVisitors;
    if (total > 0) {
      analytics.data.countries.forEach(
        (c) => (c.percentage = ((c.visitors / total) * 100).toFixed(1))
      );
      analytics.data.devices.forEach(
        (d) => (d.percentage = ((d.visitors / total) * 100).toFixed(1))
      );
      analytics.data.browsers.forEach(
        (b) => (b.percentage = ((b.visitors / total) * 100).toFixed(1))
      );
      analytics.data.operatingSystems.forEach(
        (o) => (o.percentage = ((o.visitors / total) * 100).toFixed(1))
      );
      analytics.data.referrers.forEach(
        (r) => (r.percentage = ((r.visitors / total) * 100).toFixed(1))
      );
      analytics.data.languages.forEach(
        (l) => (l.percentage = ((l.visitors / total) * 100).toFixed(1))
      );
    }

    await analytics.save();
  } catch (error) {
    console.error('Save analytics error:', error);
    throw error; // rethrow so caller knows it failed
  }
};