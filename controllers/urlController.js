// controllers/urlController.js
const Url = require('../models/Url');
const User = require('../models/User');
const Analytics = require('../models/Analytics');
const TextPage = require('../models/TextPage'); // added import for text pages
const { generateSlug } = require('../utils/helpers');
const { trackAnalytics } = require('../utils/analyticsService');
const { isValidUrl } = require('../utils/validators');
const UAParser = require('ua-parser-js'); // for rule evaluation

// Shorten URL - UPDATED to accept new fields
exports.shortenUrl = async (req, res) => {
  try {
    const {
      longUrl,
      customAlias,
      password,
      passwordNote,
      analyticsPrivate,
      expirationDate, // legacy direct expiration date
      customDomain,
      tags,
      // New fields:
      scheduledRedirect,
      splashScreen,
      expiration,      // new structured expiration object
      multipleDestinationRules,
    } = req.body;

    // Validate URL with improved validation that accepts any format
    if (!longUrl || typeof longUrl !== 'string' || longUrl.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid URL',
        field: 'longUrl',
      });
    }

    // Trim the URL
    const trimmedUrl = longUrl.trim();
    
    // Check if URL is valid using our validator
    if (!isValidUrl(trimmedUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format. Please provide a valid web address',
        field: 'longUrl',
      });
    }

    // Normalize URL - ensure it has a protocol
    let normalizedUrl = trimmedUrl;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'http://' + normalizedUrl;
    }

    // Generate or validate alias
    let alias = customAlias;
    if (!alias) {
      alias = generateSlug(6);
    } else {
      // Check if alias exists
      const existingUrl = await Url.findOne({ alias });
      if (existingUrl) {
        return res.status(400).json({
          success: false,
          message: 'Custom alias already taken',
          field: 'customAlias',
        });
      }
    }

    // Validate alias format
    const aliasPattern = /^[a-zA-Z0-9_-]{3,50}$/;
    if (!aliasPattern.test(alias)) {
      return res.status(400).json({
        success: false,
        message: 'Alias must be 3-50 characters and can only contain letters, numbers, hyphens, and underscores',
        field: 'customAlias',
      });
    }

    // Create base URL for short URL
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    
    // Create URL - Updated to include new fields
    const url = new Url({
      longUrl: normalizedUrl,
      alias,
      shortUrl: `${baseUrl}/${alias}`,
      owner: req.user ? req.user.id : null, // Will be null for public users
      type: 'url',
      password,
      passwordNote,
      analyticsPrivate: analyticsPrivate || false,
      expirationDate: expirationDate || null, // fallback if new expiration not used
      customDomain: customDomain || null,
      tags: tags || [],
      // New fields with defaults
      scheduledRedirect: scheduledRedirect || { enabled: false },
      splashScreen: splashScreen || { enabled: false },
      multipleDestinationRules: multipleDestinationRules || [],
    });

    // Handle new expiration object: if provided and enabled, override expirationDate and set expiredRedirect
    if (expiration && expiration.enabled && expiration.expireAt) {
      url.expirationDate = expiration.expireAt;
      url.expiredRedirect = expiration.expiredRedirect || null;
    }

    // Set password if provided
    if (password) {
      url.setPassword(password);
    }

    await url.save();

    // Update user stats if logged in - Updated condition for safety
    if (req.user && req.user.id) {
      const user = await User.findById(req.user.id);
      if (user) {
        user.totalUrls = (user.totalUrls || 0) + 1;
        await user.save();
      }
    }

    res.status(201).json({
      success: true,
      message: 'URL shortened successfully',
      data: {
        url: {
          _id: url._id,
          longUrl: url.longUrl,
          alias: url.alias,
          shortUrl: url.shortUrl,
          analyticsUrl: `${baseUrl}/${alias}/analytics`,
          passwordProtected: !!url.password,
          analyticsPrivate: url.analyticsPrivate,
          expirationDate: url.expirationDate,
          createdAt: url.createdAt,
          type: url.type,
          // New fields in response
          scheduledRedirect: url.scheduledRedirect,
          splashScreen: url.splashScreen,
          multipleDestinationRules: url.multipleDestinationRules,
          expiredRedirect: url.expiredRedirect,
        },
      },
    });
  } catch (error) {
    console.error('Shorten URL error:', error);
    
    // Handle duplicate key error (alias already exists)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Alias already exists. Please try a different one.',
        field: 'customAlias',
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to shorten URL',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Bulk shorten URLs - unchanged
exports.bulkShorten = async (req, res) => {
  try {
    const { urls } = req.body;
    const results = [];
    const errors = [];

    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request. URLs must be an array.',
      });
    }

    // Limit the number of URLs per request
    if (urls.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 1000 URLs per bulk request',
      });
    }

    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

    // Process URLs sequentially to avoid race conditions
    for (let i = 0; i < urls.length; i++) {
      try {
        const item = urls[i];
        const longUrl = item.long_url || item.longUrl;
        const customAlias = item.custom_slug || item.customAlias;
        let tags = item.tags || [];

        // Validate URL
        if (!longUrl || typeof longUrl !== 'string' || longUrl.trim() === '') {
          errors.push({
            row: i + 1,
            errors: ['Missing or empty URL'],
          });
          continue;
        }

        const trimmedUrl = longUrl.trim();
        
        if (!isValidUrl(trimmedUrl)) {
          errors.push({
            row: i + 1,
            errors: ['Invalid URL format'],
          });
          continue;
        }

        // Normalize URL
        let normalizedUrl = trimmedUrl;
        if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
          normalizedUrl = 'http://' + normalizedUrl;
        }

        // Generate or validate alias
        let alias = customAlias;
        if (!alias || alias.trim() === '') {
          alias = generateSlug(6);
        } else {
          alias = alias.trim();
        }

        // Check if alias exists
        const existingUrl = await Url.findOne({ alias });
        if (existingUrl) {
          if (customAlias) {
            errors.push({
              row: i + 1,
              errors: ['Custom alias already taken'],
            });
            continue;
          }
          // Regenerate if random alias exists
          alias = generateSlug(8);
        }

        // Validate alias format
        const aliasPattern = /^[a-zA-Z0-9_-]{3,50}$/;
        if (!aliasPattern.test(alias)) {
          errors.push({
            row: i + 1,
            errors: ['Alias must be 3-50 characters and can only contain letters, numbers, hyphens, and underscores'],
          });
          continue;
        }

        // Process tags
        let tagArray = [];
        if (tags) {
          if (Array.isArray(tags)) {
            tagArray = tags;
          } else if (typeof tags === 'string') {
            tagArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
          }
        }

        // Create URL
        const url = new Url({
          longUrl: normalizedUrl,
          alias,
          shortUrl: `${baseUrl}/${alias}`,
          owner: req.user ? req.user.id : null,
          type: 'url',
          tags: tagArray,
          isBulk: true,
          bulkGroup: Date.now().toString(),
        });

        await url.save();

        results.push({
          row: i + 1,
          alias: url.alias,
          shortUrl: url.shortUrl,
          analyticsUrl: `${baseUrl}/${alias}/analytics`,
          longUrl: url.longUrl,
          tags: tagArray,
          success: true,
          createdAt: url.createdAt,
        });
      } catch (error) {
        console.error(`Error processing row ${i + 1}:`, error);
        
        // Handle duplicate key error
        if (error.code === 11000) {
          errors.push({
            row: i + 1,
            errors: ['Alias already exists in the system'],
          });
        } else {
          errors.push({
            row: i + 1,
            errors: [error.message || 'Unknown error occurred'],
          });
        }
      }
    }

    // Update user stats if logged in
    if (req.user && results.length > 0) {
      try {
        const user = await User.findById(req.user.id);
        if (user) {
          user.totalUrls = (user.totalUrls || 0) + results.length;
          await user.save();
        }
      } catch (userError) {
        console.error('Error updating user stats:', userError);
        // Don't fail the whole request if user stats update fails
      }
    }

    res.json({
      success: true,
      message: 'Bulk URL processing completed',
      data: {
        results,
        errors,
        total: urls.length,
        successful: results.length,
        failed: errors.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Bulk shorten error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk URLs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get URL by alias - UPDATED to include textContent and customization for text pages
exports.getUrl = async (req, res) => {
  try {
    const { alias } = req.params;
    const password = req.query.password || req.body?.password;

    // First check for URL
    let url = await Url.findOne({ alias }).select('+password');
    let isText = false;
    let textPage = null;

    // If not found, check for TextPage
    if (!url) {
      textPage = await TextPage.findOne({ alias }).select('+password');
      if (textPage) {
        isText = true;
        // Create a URL-like object from text page
        url = {
          _id: textPage._id,
          alias: textPage.alias,
          shortUrl: textPage.shortUrl,
          longUrl: textPage.shortUrl, // text pages have no external longUrl
          type: 'text',
          owner: textPage.owner,
          active: textPage.active,
          restricted: textPage.restricted,
          expirationDate: textPage.expirationDate,
          passwordProtected: !!textPage.password,
          passwordNote: textPage.passwordNote,
          analyticsPrivate: textPage.analyticsPrivate,
          visitors: textPage.views || 0,
          clicks: textPage.views || 0,
          uniqueVisitors: textPage.uniqueViews || 0,
          createdAt: textPage.createdAt,
          lastAccessed: textPage.lastViewed,
          metadata: textPage.metadata || {},
          textContent: textPage.textContent,          // ADDED
          customization: textPage.customization,      // ADDED
          checkPassword: function(pwd) {
            return textPage.checkPassword(pwd);
          }
        };
      }
    }

    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }

    // Check if URL is active
    if (typeof url.active !== 'undefined' && !url.active) {
      return res.status(200).json({
        success: true,
        data: {
          url: {
            active: false,
            customMessage: url.customMessage || 'This URL is currently paused',
            type: 'paused'
          }
        }
      });
    }

    // Check if URL is restricted
    if (url.restricted) {
      return res.status(200).json({
        success: true,
        data: {
          url: {
            restricted: true,
            restrictionReason: url.restrictionReason,
            type: 'restricted'
          }
        }
      });
    }

    // Check if URL has expired
    if (url.expirationDate && new Date() > url.expirationDate) {
      return res.status(200).json({
        success: true,
        data: {
          url: {
            expired: true,
            expirationDate: url.expirationDate,
            type: 'expired'
          }
        }
      });
    }

    // Determine if password is set
    const hasPassword = Boolean(url.password) || Boolean(url.passwordProtected);

    // Check password if required
    if (hasPassword) {
      if (!password) {
        return res.status(200).json({
          success: true,
          data: {
            url: {
              _id: url._id,
              alias: url.alias,
              shortUrl: url.shortUrl,
              owner: url.owner,
              type: url.type || 'url',
              active: url.active,
              passwordProtected: true,
              passwordNote: url.passwordNote || null,
              requiresPassword: true,
              analyticsPrivate: url.analyticsPrivate,
              expirationDate: url.expirationDate,
              createdAt: url.createdAt,
              ...(isText && { textContent: url.textContent, customization: url.customization }) // include if already fetched
            }
          }
        });
      }

      const isPasswordValid = url.checkPassword ? url.checkPassword(password) : false;
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password',
          requiresPassword: true,
        });
      }
      // password valid – continue
    }

    // Return URL data
    res.json({
      success: true,
      data: {
        url: {
          _id: url._id,
          longUrl: url.longUrl || url.shortUrl,
          alias: url.alias,
          shortUrl: url.shortUrl,
          owner: url.owner,
          type: url.type || 'url',
          visitors: url.visitors || 0,
          clicks: url.clicks || 0,
          uniqueVisitors: url.uniqueVisitors || 0,
          createdAt: url.createdAt,
          lastAccessed: url.lastAccessed,
          metadata: url.metadata,
          active: url.active,
          passwordProtected: hasPassword,
          analyticsPrivate: url.analyticsPrivate,
          expirationDate: url.expirationDate,
          scheduledRedirect: url.scheduledRedirect || { enabled: false },
          splashScreen: url.splashScreen || { enabled: false },
          multipleDestinationRules: url.multipleDestinationRules || [],
          expiredRedirect: url.expiredRedirect,
          // Additional fields for text pages
          ...(isText && {
            textContent: url.textContent,
            customization: url.customization
          })
        },
      },
    });
  } catch (error) {
    console.error('Get URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch URL',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get user URLs - unchanged
exports.getUserUrls = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = { owner: req.user.id };

    // Filter by type
    if (type && type !== 'all') {
      query.type = type;
    }

    // Search filter
    if (search) {
      query.$or = [
        { alias: { $regex: search, $options: 'i' } },
        { longUrl: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    // Sort options
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [urls, total] = await Promise.all([
      Url.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Url.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        urls,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Get user URLs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch URLs',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Update URL - unchanged (will automatically include new fields if sent)
exports.updateUrl = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const url = await Url.findOne({ _id: id, owner: req.user.id });

    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }

    // Check if alias is being updated
    if (updateData.alias && updateData.alias !== url.alias) {
      const existingUrl = await Url.findOne({ alias: updateData.alias });
      if (existingUrl) {
        return res.status(400).json({
          success: false,
          message: 'Alias already taken',
          field: 'alias',
        });
      }
    }

    // Update password if provided
    if (updateData.password !== undefined) {
      if (updateData.password === '') {
        url.setPassword(null);
        url.passwordNote = null;
      } else {
        url.setPassword(updateData.password);
        if (updateData.passwordNote) {
          url.passwordNote = updateData.passwordNote;
        }
      }
      delete updateData.password;
    }

    // Get base URL
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

    // Update fields
    Object.keys(updateData).forEach(key => {
      if (key !== 'password' && key !== 'passwordNote') {
        url[key] = updateData[key];
      }
    });

    // Update shortUrl if alias changed
    if (updateData.alias) {
      url.shortUrl = `${baseUrl}/${updateData.alias}`;
    }

    await url.save();

    res.json({
      success: true,
      message: 'URL updated successfully',
      data: {
        url: {
          _id: url._id,
          alias: url.alias,
          shortUrl: url.shortUrl,
          analyticsUrl: `${baseUrl}/${url.alias}/analytics`,
          longUrl: url.longUrl,
          analyticsPrivate: url.analyticsPrivate,
          expirationDate: url.expirationDate,
          passwordProtected: !!url.password,
          active: url.active,
          restricted: url.restricted,
          updatedAt: url.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error('Update URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update URL',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Delete URL - unchanged
exports.deleteUrl = async (req, res) => {
  try {
    const { id } = req.params;

    const url = await Url.findOneAndDelete({ _id: id, owner: req.user.id });

    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }

    // Update user stats
    const user = await User.findById(req.user.id);
    if (user) {
      user.totalUrls = Math.max(0, (user.totalUrls || 0) - 1);
      await user.save();
    }

    // Delete associated analytics
    await Analytics.deleteMany({ alias: url.alias });

    res.json({
      success: true,
      message: 'URL deleted successfully',
    });
  } catch (error) {
    console.error('Delete URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete URL',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Toggle URL active status - unchanged
exports.toggleUrlActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { active, customMessage } = req.body;

    const url = await Url.findOne({ _id: id, owner: req.user.id });

    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }

    url.active = active !== undefined ? active : !url.active;
    if (customMessage !== undefined) {
      url.customMessage = customMessage;
    }

    await url.save();

    res.json({
      success: true,
      message: `URL ${url.active ? 'activated' : 'paused'} successfully`,
      data: {
        url: {
          _id: url._id,
          alias: url.alias,
          active: url.active,
          customMessage: url.customMessage,
        },
      },
    });
  } catch (error) {
    console.error('Toggle URL active error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update URL status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Verify password - UPDATED to handle text pages
exports.verifyPassword = async (req, res) => {
  try {
    const { alias } = req.params;
    const { password } = req.body;

    // First check for URL
    let url = await Url.findOne({ alias }).select('+password');
    let isText = false;
    let textPage = null;

    if (!url) {
      textPage = await TextPage.findOne({ alias }).select('+password');
      if (textPage) {
        isText = true;
        url = {
          _id: textPage._id,
          alias: textPage.alias,
          shortUrl: textPage.shortUrl,
          longUrl: textPage.shortUrl,
          type: 'text',
          owner: textPage.owner,
          active: textPage.active,
          restricted: textPage.restricted,
          expirationDate: textPage.expirationDate,
          passwordProtected: !!textPage.password,
          passwordNote: textPage.passwordNote,
          textContent: textPage.textContent,
          customization: textPage.customization,
          checkPassword: function(pwd) {
            return textPage.checkPassword(pwd);
          }
        };
      }
    }

    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }

    const hasPassword = Boolean(url.password) || Boolean(url.passwordProtected);

    if (!hasPassword) {
      // If not password protected, just return success and the target
      return res.json({
        success: true,
        valid: true,
        redirectTo: url.longUrl,
        type: url.type,
        ...(isText && { textContent: url.textContent, customization: url.customization })
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: 'Password is required'
      });
    }

    const isValid = url.checkPassword ? url.checkPassword(password) : false;

    if (!isValid) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: 'Invalid password',
      });
    }

    // Password correct
    if (isText) {
      // For text pages, return the full content (no redirect)
      return res.json({
        success: true,
        valid: true,
        type: 'text',
        textContent: url.textContent,
        customization: url.customization,
        alias: url.alias,
        shortUrl: url.shortUrl
      });
    } else {
      // For URLs, return the redirect destination
      return res.json({
        success: true,
        valid: true,
        redirectTo: url.longUrl,
        type: 'url'
      });
    }
  } catch (error) {
    console.error('Verify password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify password',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Check alias availability - unchanged
exports.checkAlias = async (req, res) => {
  try {
    const { alias } = req.params;

    // Validate alias format
    const aliasPattern = /^[a-zA-Z0-9_-]{3,50}$/;
    if (!aliasPattern.test(alias)) {
      return res.status(400).json({
        success: false,
        available: false,
        message: 'Alias must be 3-50 characters and can only contain letters, numbers, hyphens, and underscores',
      });
    }

    const existingUrl = await Url.findOne({ alias });

    res.json({
      success: true,
      available: !existingUrl,
      message: existingUrl ? 'Alias already taken' : 'Alias available',
    });
  } catch (error) {
    console.error('Check alias error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check alias',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get URL stats - unchanged
exports.getUrlStats = async (req, res) => {
  try {
    const { alias } = req.params;
    const { timeframe = 'overall' } = req.query;

    const url = await Url.findOne({ alias, owner: req.user.id });

    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }

    // Calculate time range
    const now = new Date();
    let startDate;
    switch (timeframe) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'yesterday':
        startDate = new Date(now.setDate(now.getDate() - 1));
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'last7days':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'last30days':
        startDate = new Date(now.setDate(now.getDate() - 30));
        break;
      case 'last60days':
        startDate = new Date(now.setDate(now.getDate() - 60));
        break;
      case 'lastYear':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = null; // overall
    }

    // Get analytics data
    const analyticsQuery = { alias };
    if (startDate) {
      analyticsQuery.date = { $gte: startDate };
    }

    const analyticsData = await Analytics.find(analyticsQuery)
      .sort({ date: 1 })
      .lean();

    // Calculate summary
    const summary = {
      totalVisitors: url.visitors,
      totalClicks: url.clicks,
      uniqueVisitors: url.uniqueVisitors,
      engagementRate: url.visitors > 0 ? ((url.clicks / url.visitors) * 100).toFixed(2) : 0,
      lastAccessed: url.lastAccessed,
      status: url.getStatus(),
    };

    // Process time series data
    const timeSeries = analyticsData.map(day => ({
      date: day.date,
      visitors: day.data?.summary?.totalVisitors || 0,
      clicks: day.data?.summary?.totalClicks || 0,
      uniqueVisitors: day.data?.summary?.uniqueVisitors || 0,
    }));

    // Get countries data
    const countries = analyticsData.reduce((acc, day) => {
      if (day.data?.countries) {
        day.data.countries.forEach(country => {
          const existing = acc.find(c => c.country === country.country);
          if (existing) {
            existing.visitors += country.visitors;
          } else {
            acc.push({ ...country });
          }
        });
      }
      return acc;
    }, []);

    // Calculate percentages
    const totalCountryVisitors = countries.reduce((sum, c) => sum + c.visitors, 0);
    countries.forEach(country => {
      country.percentage = totalCountryVisitors > 0 
        ? ((country.visitors / totalCountryVisitors) * 100).toFixed(1)
        : 0;
    });

    // Sort by visitors
    countries.sort((a, b) => b.visitors - a.visitors);

    res.json({
      success: true,
      data: {
        url: {
          _id: url._id,
          alias: url.alias,
          shortUrl: url.shortUrl,
          longUrl: url.longUrl,
          type: url.type,
          createdAt: url.createdAt,
          expirationDate: url.expirationDate,
          passwordProtected: url.passwordProtected,
          analyticsPrivate: url.analyticsPrivate,
        },
        summary,
        timeSeries,
        countries: countries.slice(0, 10), // Top 10 countries
        timeframe,
      },
    });
  } catch (error) {
    console.error('Get URL stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch URL stats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Export data - unchanged
exports.exportData = async (req, res) => {
  try {
    const { alias } = req.params;
    
    // Find the URL
    const url = await Url.findOne({ alias, owner: req.user.id });
    
    if (!url) {
      return res.status(404).json({
        success: false,
        message: 'URL not found',
      });
    }
    
    // Get analytics data
    const analytics = await Analytics.find({ alias }).sort({ date: -1 });
    
    // Prepare export data
    const exportData = {
      url: {
        _id: url._id,
        alias: url.alias,
        longUrl: url.longUrl,
        shortUrl: url.shortUrl,
        createdAt: url.createdAt,
        updatedAt: url.updatedAt,
        expirationDate: url.expirationDate,
        passwordProtected: url.passwordProtected,
        analyticsPrivate: url.analyticsPrivate,
        active: url.active,
        restricted: url.restricted,
        visitors: url.visitors,
        clicks: url.clicks,
        uniqueVisitors: url.uniqueVisitors,
        lastAccessed: url.lastAccessed,
        tags: url.tags
      },
      analytics: analytics
    };
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${alias}-export-${Date.now()}.json`);
    
    // Send the data
    res.json({
      success: true,
      data: exportData
    });
    
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Helper: evaluate multiple destination rules (used by redirectUrl and evaluateRules)
const evaluateDestinationRules = (rules, req) => {
  if (!rules || rules.length === 0) return null;

  // Extract data from request headers
  const country = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const userAgent = req.headers['user-agent'] || '';

  // Parse user agent for OS, device, browser
  const ua = UAParser(userAgent);
  const os = ua.os.name || '';
  const device = ua.device.type || 'desktop';
  const browser = ua.browser.name || '';

  // Get current time (HH:MM)
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Helper to evaluate a condition
  function evaluateCondition(cond, value) {
    switch (cond.operator) {
      case 'eq': return cond.value.toLowerCase() === value.toLowerCase();
      case 'neq': return cond.value.toLowerCase() !== value.toLowerCase();
      case 'in': return cond.value.split(',').map(v => v.trim().toLowerCase()).includes(value.toLowerCase());
      case 'regex': return new RegExp(cond.value, 'i').test(value);
      default: return false;
    }
  }

  // Sort rules by priority (lower number = higher priority)
  const sortedRules = [...rules].sort((a, b) => (a.priority || 0) - (b.priority || 0));

  for (const rule of sortedRules) {
    let allConditionsMatch = true;
    for (const condition of rule.conditions) {
      let actualValue;
      switch (condition.field) {
        case 'country': actualValue = country; break;
        case 'language': actualValue = acceptLanguage.split(',')[0] || ''; break;
        case 'os': actualValue = os; break;
        case 'device': actualValue = device; break;
        case 'browser': actualValue = browser; break;
        case 'time': actualValue = currentTime; break;
        default: actualValue = '';
      }
      if (!evaluateCondition(condition, actualValue)) {
        allConditionsMatch = false;
        break;
      }
    }
    if (allConditionsMatch) {
      return rule.destination;
    }
  }

  return null; // no rule matched
};

// NEW: Evaluate multiple destination rules (API endpoint)
exports.evaluateRules = async (req, res) => {
  try {
    const { alias } = req.params;
    const url = await Url.findOne({ alias });
    if (!url) {
      return res.status(404).json({ success: false, message: 'URL not found' });
    }

    const rules = url.multipleDestinationRules || [];
    if (rules.length === 0) {
      return res.json({ success: true, destination: url.longUrl });
    }

    const destination = evaluateDestinationRules(rules, req);
    res.json({
      success: true,
      destination: destination || url.longUrl
    });
  } catch (error) {
    console.error('Evaluate rules error:', error);
    res.status(500).json({ success: false, message: 'Failed to evaluate rules' });
  }
};

// Redirect URL - MODIFIED to respect req.tracked flag
exports.redirectUrl = async (req, res) => {
  try {
    const { alias } = req.params;
    
    // First, try to find the URL
    const url = await Url.findOne({ alias }).select('+password');
    
    if (!url) {
      // If not found, check if it's an analytics page request
      if (req.path.endsWith('/analytics')) {
        return res.redirect(`/analytics/${alias}`);
      }
      
      // Return 404 for non-existent URLs
      return res.status(404).json({
        success: false,
        message: 'URL not found',
        type: 'not_found'
      });
    }
    
    // Check if URL is active
    if (!url.active) {
      return res.status(200).json({
        success: true,
        type: 'paused',
        message: url.customMessage || 'This URL is currently paused',
        customMessage: url.customMessage
      });
    }
    
    // Check if URL is restricted
    if (url.restricted) {
      return res.status(200).json({
        success: true,
        type: 'restricted',
        message: url.restrictionReason || 'This URL is restricted'
      });
    }
    
    // --- EXPIRATION CHECK (with expiredRedirect) ---
    if (url.expirationDate && new Date() > url.expirationDate) {
      if (url.expiredRedirect) {
        // Redirect to the configured expiredRedirect URL
        return res.redirect(url.expiredRedirect);
      }
      return res.status(200).json({
        success: true,
        type: 'expired',
        message: 'This URL has expired'
      });
    }
    
    // --- SCHEDULED REDIRECT ---
    if (url.scheduledRedirect && url.scheduledRedirect.enabled) {
      const now = new Date();
      const start = url.scheduledRedirect.startDate ? new Date(url.scheduledRedirect.startDate) : null;
      const end = url.scheduledRedirect.endDate ? new Date(url.scheduledRedirect.endDate) : null;
      let isInSchedule = true;
      if (start && now < start) isInSchedule = false;
      if (end && now > end) isInSchedule = false;
      if (isInSchedule && url.scheduledRedirect.redirectUrl) {
        return res.redirect(url.scheduledRedirect.redirectUrl);
      }
    }
    
    // --- PASSWORD PROTECTION ---
    // Check if password is required
    if (url.passwordProtected || url.password) {
      // Check if password was provided in query or body
      const password = req.query.password || req.body.password;
      
      if (!password) {
        return res.status(200).json({
          success: true,
          type: 'password',
          passwordNote: url.passwordNote,
          requiresPassword: true
        });
      }
      
      // Verify password
      const isValid = url.checkPassword(password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password',
          requiresPassword: true
        });
      }
    }
    
    // --- DETERMINE FINAL DESTINATION (rules or fallback) ---
    let destination = url.longUrl;
    if (url.multipleDestinationRules && url.multipleDestinationRules.length > 0) {
      const ruleDestination = evaluateDestinationRules(url.multipleDestinationRules, req);
      if (ruleDestination) {
        destination = ruleDestination;
      }
    }
    
    // --- SPLASH SCREEN ---
    if (url.splashScreen && url.splashScreen.enabled) {
      // Return splash screen data without redirecting
      return res.status(200).json({
        success: true,
        type: 'splash',
        splashScreen: {
          title: url.splashScreen.title || '',
          message: url.splashScreen.message || '',
          image: url.splashScreen.image || null,
          redirectDelay: url.splashScreen.redirectDelay || 5, // seconds
        },
        destination: destination // the URL to redirect to after splash
      });
    }
    
    // --- TRACK ANALYTICS ---
    // ✅ Only track if not already tracked by the /:alias route
    if (!req.tracked && process.env.ENABLE_ANALYTICS !== 'false') {
      try {
        const analyticsData = await trackAnalytics(url, req);
        await url.incrementVisitors(analyticsData.isUnique);
      } catch (analyticsError) {
        console.error('Analytics tracking error:', analyticsError);
        // Don't fail the redirect if analytics fails
      }
    } else if (!req.tracked) {
      // Still increment basic counters if analytics disabled
      await url.incrementVisitors(false);
    }
    
    // --- REDIRECT ---
    // If it's an API request (has Accept: application/json header), return JSON with longUrl
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({
        success: true,
        data: {
          url: {
            longUrl: destination,
            alias: url.alias,
            shortUrl: url.shortUrl
          }
        }
      });
    }
    
    // Otherwise, redirect
    res.redirect(destination);
    
  } catch (error) {
    console.error('Redirect error:', error);
    
    // Return appropriate error response
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({
        success: false,
        message: 'Failed to redirect',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    // For browser requests, you might want to redirect to an error page
    // or return a simple error message
    res.status(500).send(`
      <html>
        <head><title>Redirect Error</title></head>
        <body>
          <h1>Redirect Error</h1>
          <p>Failed to redirect. Please try again later.</p>
          <a href="/">Go back home</a>
        </body>
      </html>
    `);
  }
};