const QRCodeModel = require('../models/QRCode');
const User = require('../models/User');
const Analytics = require('../models/Analytics');
const Notification = require('../models/Notification');
const { uploadImage, deleteImage, cloudinary } = require('../config/cloudinary');
const QRCodeGenerator = require('qrcode');
const sharp = require('sharp');
const { COIN_VALUES } = require('../config/constants');
const logger = require('../utils/logger');
const { isValidUrl } = require('../utils/validators');

// Generate QR Code - UPDATED to accept any URL format
exports.generateQR = async (req, res) => {
  try {
    const {
      destinationUrl,
      customAlias,
      customization = {},
      analyticsPrivate = false,
      expirationDate = null,
      password = null,
      passwordNote = null,
      tags = [],
    } = req.body;

    // Validate URL using the same validator as URL shortener
    if (!destinationUrl || typeof destinationUrl !== 'string' || destinationUrl.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid URL',
        field: 'destinationUrl',
      });
    }

    // Trim the URL
    const trimmedUrl = destinationUrl.trim();
    
    // Validate URL format
    if (!isValidUrl(trimmedUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format. Please provide a valid web address',
        field: 'destinationUrl',
      });
    }

    // Normalize URL - ensure it has a protocol for QR code generation
    let normalizedUrl = trimmedUrl;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'http://' + normalizedUrl;
    }

    // Check if user can create more QR codes
    if (req.user) {
      const user = await User.findById(req.user.id);
      if (!user.canCreateUrl('qr')) {
        return res.status(403).json({
          success: false,
          message: 'QR code limit reached. Upgrade your tier to create more.',
        });
      }
    }

    // Generate or validate alias
    let alias = customAlias;
    if (!alias) {
      alias = generateSlug(6);
    }

    // Check if alias exists
    const existingQR = await QRCodeModel.findOne({ alias });
    if (existingQR) {
      if (customAlias) {
        return res.status(400).json({
          success: false,
          message: 'Custom alias already taken',
          field: 'customAlias',
        });
      }
      // Regenerate if random alias exists
      alias = generateSlug(8);
    }

    // Validate alias format
    const aliasPattern = /^[a-zA-Z0-9_-]+$/;
    if (!aliasPattern.test(alias)) {
      return res.status(400).json({
        success: false,
        message: 'Alias can only contain letters, numbers, hyphens, and underscores',
        field: 'customAlias',
      });
    }

    // Generate QR code image
    const qrCodeOptions = {
      errorCorrectionLevel: 'H',
      margin: customization.margin || 4,
      width: 400,
      color: {
        dark: customization.qrColor || '#000000',
        light: customization.bgColor || '#FFFFFF',
      },
    };

    // Generate QR code data URL using normalized URL
    const qrCodeDataUrl = await QRCodeGenerator.toDataURL(normalizedUrl, qrCodeOptions);

    // Process QR code with customization
    let qrCodeBuffer = Buffer.from(qrCodeDataUrl.split(',')[1], 'base64');
    
    // Add logo if provided
    if (customization.logo && req.files?.logo) {
      const logoFile = req.files.logo[0];
      
      // Resize logo
      const logoSize = customization.logoSize || 40;
      const logoBuffer = await sharp(logoFile.buffer)
        .resize(logoSize, logoSize, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .toBuffer();
      
      // Composite logo onto QR code
      qrCodeBuffer = await sharp(qrCodeBuffer)
        .composite([{ input: logoBuffer, gravity: 'center' }])
        .toBuffer();
    }

    // Upload QR code to Cloudinary
    const uploadResult = await uploadImage(`data:image/png;base64,${qrCodeBuffer.toString('base64')}`, {
      folder: 'url-shortener/qr-codes',
      public_id: `qr_${alias}_${Date.now()}`,
      overwrite: false,
    });

    if (!uploadResult.success) {
      throw new Error('Failed to upload QR code image');
    }

    // Create QR code in database
    const qrCode = new QRCodeModel({
      alias,
      shortUrl: `${process.env.BASE_URL || process.env.FRONTEND_URL}/${alias}`,
      destinationUrl: normalizedUrl, // Store normalized URL
      originalUrl: trimmedUrl, // Store original input for reference
      owner: req.user ? req.user.id : null,
      customization: {
        qrColor: customization.qrColor || '#000000',
        bgColor: customization.bgColor || '#FFFFFF',
        includeText: customization.includeText || false,
        text: customization.text || '',
        textPosition: customization.textPosition || 'bottom',
        textColor: customization.textColor || '#000000',
        textFont: customization.textFont || 'Arial',
        textSize: customization.textSize || 16,
        logo: customization.logo || null,
        logoSize: customization.logoSize || 40,
        patternStyle: customization.patternStyle || 'square',
        eyeStyle: customization.eyeStyle || 'square',
        gradient: customization.gradient || { enabled: false },
        corners: customization.corners !== undefined ? customization.corners : true,
        margin: customization.margin || 4,
      },
      qrImage: uploadResult.url,
      qrImagePublicId: uploadResult.public_id,
      qrImageUrl: uploadResult.url,
      analyticsPrivate,
      expirationDate,
      password,
      passwordNote,
      tags,
      metadata: {
        size: uploadResult.bytes,
        format: uploadResult.format,
        errorCorrectionLevel: 'H',
        version: 1,
        margin: customization.margin || 4,
      },
    });

    // Set password if provided
    if (password) {
      qrCode.setPassword(password);
    }

    await qrCode.save();

    // Update user stats and add coins
    if (req.user) {
      const user = await User.findById(req.user.id);
      await user.updateStats();
      await user.addCoins(COIN_VALUES.QR_CREATED, 'qr_created');
    }

    // Create notification
    if (req.user) {
      await Notification.createNotification(req.user.id, {
        type: 'qr_created',
        title: 'QR Code Created',
        message: `Your QR code /${alias} has been generated`,
        data: {
          qrId: qrCode._id,
          alias: qrCode.alias,
          amount: COIN_VALUES.QR_CREATED,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: 'QR code generated successfully',
      data: {
        qrCode: {
          _id: qrCode._id,
          alias: qrCode.alias,
          shortUrl: qrCode.shortUrl,
          destinationUrl: qrCode.destinationUrl,
          qrImage: qrCode.qrImage,
          qrImageUrl: qrCode.qrImageUrl,
          analyticsUrl: qrCode.analyticsUrl,
          customization: qrCode.customization,
          analyticsPrivate: qrCode.analyticsPrivate,
          expirationDate: qrCode.expirationDate,
          passwordProtected: !!qrCode.password,
          createdAt: qrCode.createdAt,
        },
      },
    });
  } catch (error) {
    logger.error('Generate QR error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate QR code',
      error: error.message,
    });
  }
};

// Get QR code by alias
exports.getQRCode = async (req, res) => {
  try {
    const { alias } = req.params;
    const { password } = req.body;

    const qrCode = await QRCodeModel.findOne({ alias });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found',
      });
    }

    // Check if QR code is active
    if (!qrCode.active) {
      return res.status(403).json({
        success: false,
        message: 'QR code is paused',
        customMessage: qrCode.customMessage,
      });
    }

    // Check if QR code is restricted
    if (qrCode.restricted) {
      return res.status(403).json({
        success: false,
        message: 'QR code is restricted',
        reason: qrCode.restrictionReason,
      });
    }

    // Check if QR code has expired
    if (qrCode.expirationDate && new Date() > qrCode.expirationDate) {
      return res.status(403).json({
        success: false,
        message: 'QR code has expired',
      });
    }

    // Check password if required
    if (qrCode.password) {
      if (!password) {
        return res.status(401).json({
          success: false,
          message: 'Password required',
          passwordNote: qrCode.passwordNote,
          requiresPassword: true,
        });
      }

      const isPasswordValid = qrCode.checkPassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password',
          requiresPassword: true,
        });
      }
    }

    // Check analytics privacy
    if (qrCode.analyticsPrivate && (!req.user || req.user.id !== qrCode.owner?.toString())) {
      return res.status(403).json({
        success: false,
        message: 'Analytics for this QR code are private',
      });
    }

    res.json({
      success: true,
      data: {
        qrCode: {
          _id: qrCode._id,
          alias: qrCode.alias,
          shortUrl: qrCode.shortUrl,
          destinationUrl: qrCode.destinationUrl,
          qrImage: qrCode.qrImage,
          qrImageUrl: qrCode.qrImageUrl,
          customization: qrCode.customization,
          scans: qrCode.scans,
          uniqueScans: qrCode.uniqueScans,
          todayScans: qrCode.todayScans,
          lastScanned: qrCode.lastScanned,
          analyticsPrivate: qrCode.analyticsPrivate,
          expirationDate: qrCode.expirationDate,
          passwordProtected: !!qrCode.password,
          tags: qrCode.tags,
          createdAt: qrCode.createdAt,
          updatedAt: qrCode.updatedAt,
        },
      },
    });
  } catch (error) {
    logger.error('Get QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch QR code',
    });
  }
};

// Get user's QR codes
exports.getUserQRCodes = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    const query = { owner: req.user.id };

    // Search filter
    if (search) {
      query.$or = [
        { alias: { $regex: search, $options: 'i' } },
        { destinationUrl: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    // Sort options
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [qrCodes, total] = await Promise.all([
      QRCodeModel.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      QRCodeModel.countDocuments(query),
    ]);

    // Format response
    const formattedQRCodes = qrCodes.map(qr => ({
      ...qr,
      analyticsUrl: `${process.env.FRONTEND_URL}/${qr.alias}/analytics`,
      passwordProtected: !!qr.password,
      status: getQRStatus(qr),
    }));

    res.json({
      success: true,
      data: {
        qrCodes: formattedQRCodes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    logger.error('Get user QR codes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch QR codes',
    });
  }
};

// Update QR code
exports.updateQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const qrCode = await QRCodeModel.findOne({ _id: id, owner: req.user.id });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found',
      });
    }

    // Check if alias is being updated
    if (updateData.alias && updateData.alias !== qrCode.alias) {
      const existingQR = await QRCodeModel.findOne({ alias: updateData.alias });
      if (existingQR) {
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
        qrCode.setPassword(null);
        qrCode.passwordNote = null;
      } else {
        qrCode.setPassword(updateData.password);
        if (updateData.passwordNote) {
          qrCode.passwordNote = updateData.passwordNote;
        }
      }
      delete updateData.password;
      delete updateData.passwordNote;
    }

    // Handle logo update
    if (req.files?.logo) {
      const logoFile = req.files.logo[0];
      
      // Delete old logo if exists
      if (qrCode.customization.logoPublicId) {
        await deleteImage(qrCode.customization.logoPublicId);
      }
      
      // Upload new logo
      const uploadResult = await uploadImage(`data:image/png;base64,${logoFile.buffer.toString('base64')}`, {
        folder: 'url-shortener/qr-logos',
        transformation: [
          { width: 100, height: 100, crop: 'fill' },
          { quality: 'auto' },
        ],
      });
      
      if (uploadResult.success) {
        qrCode.customization.logo = uploadResult.url;
        qrCode.customization.logoPublicId = uploadResult.public_id;
      }
    }

    // Update other fields
    Object.keys(updateData).forEach(key => {
      if (key !== 'password' && key !== 'passwordNote') {
        if (key.startsWith('customization.')) {
          const prop = key.split('.')[1];
          qrCode.customization[prop] = updateData[key];
        } else {
          qrCode[key] = updateData[key];
        }
      }
    });

    await qrCode.save();

    res.json({
      success: true,
      message: 'QR code updated successfully',
      data: {
        qrCode: {
          _id: qrCode._id,
          alias: qrCode.alias,
          shortUrl: qrCode.shortUrl,
          destinationUrl: qrCode.destinationUrl,
          qrImage: qrCode.qrImage,
          customization: qrCode.customization,
          analyticsPrivate: qrCode.analyticsPrivate,
          expirationDate: qrCode.expirationDate,
          passwordProtected: !!qrCode.password,
          active: qrCode.active,
          restricted: qrCode.restricted,
          updatedAt: qrCode.updatedAt,
        },
      },
    });
  } catch (error) {
    logger.error('Update QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update QR code',
    });
  }
};

// Delete QR code
exports.deleteQRCode = async (req, res) => {
  try {
    const { id } = req.params;

    const qrCode = await QRCodeModel.findOne({ _id: id, owner: req.user.id });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found',
      });
    }

    // Delete QR code image from Cloudinary
    if (qrCode.qrImagePublicId) {
      await deleteImage(qrCode.qrImagePublicId);
    }

    // Delete logo from Cloudinary
    if (qrCode.customization.logoPublicId) {
      await deleteImage(qrCode.customization.logoPublicId);
    }

    // Delete from database
    await QRCodeModel.findByIdAndDelete(id);

    // Update user stats
    const user = await User.findById(req.user.id);
    await user.updateStats();

    // Delete associated analytics
    await Analytics.deleteMany({ alias: qrCode.alias });

    res.json({
      success: true,
      message: 'QR code deleted successfully',
    });
  } catch (error) {
    logger.error('Delete QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete QR code',
    });
  }
};

// Toggle QR code active status
exports.toggleQRActive = async (req, res) => {
  try {
    const { id } = req.params;
    const { active, customMessage } = req.body;

    const qrCode = await QRCodeModel.findOne({ _id: id, owner: req.user.id });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found',
      });
    }

    qrCode.active = active !== undefined ? active : !qrCode.active;
    if (customMessage !== undefined) {
      qrCode.customMessage = customMessage;
    }

    await qrCode.save();

    res.json({
      success: true,
      message: `QR code ${qrCode.active ? 'activated' : 'paused'} successfully`,
      data: {
        qrCode: {
          _id: qrCode._id,
          alias: qrCode.alias,
          active: qrCode.active,
          customMessage: qrCode.customMessage,
        },
      },
    });
  } catch (error) {
    logger.error('Toggle QR active error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update QR code status',
    });
  }
};

// Scan QR code (track scan)
exports.scanQRCode = async (req, res) => {
  try {
    const { alias } = req.params;
    const { password } = req.body;

    const qrCode = await QRCodeModel.findOne({ alias });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found',
      });
    }

    // Check if QR code is active
    if (!qrCode.active) {
      return res.status(403).json({
        success: false,
        message: 'QR code is paused',
        customMessage: qrCode.customMessage,
      });
    }

    // Check if QR code is restricted
    if (qrCode.restricted) {
      return res.status(403).json({
        success: false,
        message: 'QR code is restricted',
        reason: qrCode.restrictionReason,
      });
    }

    // Check if QR code has expired
    if (qrCode.expirationDate && new Date() > qrCode.expirationDate) {
      return res.status(403).json({
        success: false,
        message: 'QR code has expired',
      });
    }

    // Check password if required
    if (qrCode.password) {
      if (!password) {
        return res.status(401).json({
          success: false,
          message: 'Password required',
          passwordNote: qrCode.passwordNote,
          requiresPassword: true,
        });
      }

      const isPasswordValid = qrCode.checkPassword(password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password',
          requiresPassword: true,
        });
      }
    }

    // Track analytics
    const analyticsService = require('../utils/analyticsService');
    const analyticsData = await analyticsService.trackAnalytics({
      alias: qrCode.alias,
      type: 'qr',
      owner: qrCode.owner,
    }, req);

    // Increment scans
    await qrCode.incrementScans(analyticsData.isUnique);

    // Emit real-time analytics update
    if (req.io && qrCode.owner) {
      req.io.to(`analytics:${alias}`).emit('analytics-update', {
        alias,
        type: 'scan',
        data: analyticsData,
      });
    }

    res.json({
      success: true,
      message: 'QR code scanned successfully',
      data: {
        destinationUrl: qrCode.destinationUrl,
        scans: qrCode.scans,
        uniqueScans: qrCode.uniqueScans,
      },
    });
  } catch (error) {
    logger.error('Scan QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to scan QR code',
    });
  }
};

// ==================== FIXED DOWNLOAD FUNCTION ====================
// Download QR code image – now uses stored Cloudinary image if available
exports.downloadQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'png', size = 400 } = req.query;

    const qrCode = await QRCodeModel.findOne({ _id: id, owner: req.user.id });

    if (!qrCode) {
      return res.status(404).json({
        success: false,
        message: 'QR code not found',
      });
    }

    // If we have a stored QR image in Cloudinary, use it for download
    if (qrCode.qrImagePublicId) {
      try {
        // Build Cloudinary URL with transformations and forced download
        const downloadUrl = cloudinary.url(qrCode.qrImagePublicId, {
          format: format,
          width: parseInt(size),
          crop: 'scale',
          flags: `attachment:qrcode-${qrCode.alias}.${format}`,
          secure: true,
        });

        // Redirect to the Cloudinary URL – this triggers the download
        return res.redirect(downloadUrl);
      } catch (cloudinaryError) {
        logger.error('Cloudinary download error:', cloudinaryError);
        // Fall back to generation if Cloudinary fails
      }
    }

    // Fallback: Generate QR code with specified size and format (no logo)
    const qrCodeOptions = {
      errorCorrectionLevel: 'H',
      margin: qrCode.customization.margin || 4,
      width: parseInt(size),
      color: {
        dark: qrCode.customization.qrColor || '#000000',
        light: qrCode.customization.bgColor || '#FFFFFF',
      },
      type: format === 'svg' ? 'svg' : 'png',
    };

    const qrCodeData = await QRCodeGenerator.toBuffer(qrCode.destinationUrl, qrCodeOptions);

    res.set({
      'Content-Type': format === 'svg' ? 'image/svg+xml' : 'image/png',
      'Content-Disposition': `attachment; filename="qrcode-${qrCode.alias}.${format}"`,
      'Content-Length': qrCodeData.length,
    });

    res.send(qrCodeData);
  } catch (error) {
    logger.error('Download QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download QR code',
    });
  }
};

// Helper function to generate slug
function generateSlug(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper function to get QR code status
function getQRStatus(qr) {
  if (qr.restricted) return 'restricted';
  if (!qr.active) return 'paused';
  if (qr.expirationDate && new Date(qr.expirationDate) < new Date()) {
    return 'expired';
  }
  return 'active';
}