// controllers/textController.js - UPDATED WITH ALIAS UNIQUENESS ACROSS URLS
const TextPage = require('../models/TextPage');
const User = require('../models/User');
const Url = require('../models/Url'); // ADDED: import Url model
const Notification = require('../models/Notification');
const analyticsService = require('../utils/analyticsService');
const logger = require('../utils/logger');

// Helper function to generate slug
const generateSlug = (length = 6) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

exports.createTextPage = async (req, res) => {
  try {
    const { 
      text, 
      customAlias, 
      customization = {}, 
      allowResponse = false,
      tags = [], 
      analyticsPrivate = false, 
      expirationDate = null, 
      password = null, 
      passwordNote = null 
    } = req.body;
    
    // Validate text content
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Text content is required' 
      });
    }

    // Validate text length
    const trimmedText = text.trim();
    if (trimmedText.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Text content cannot exceed 5000 characters',
        field: 'text'
      });
    }

    // Generate or validate alias
    let alias = customAlias;
    if (!alias) {
      alias = generateSlug(6);
    } else {
      // Check if alias already exists in EITHER TextPage OR Url collection
      const existingTextPage = await TextPage.findOne({ alias });
      const existingUrl = await Url.findOne({ alias });
      if (existingTextPage || existingUrl) {
        return res.status(400).json({ 
          success: false, 
          message: 'Alias already taken', 
          field: 'customAlias' 
        });
      }
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

    // Get base URL
    const baseUrl = process.env.BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    
    // Create text page object
    const textPageData = {
      alias,
      shortUrl: `${baseUrl}/${alias}`,
      textContent: trimmedText,
      owner: req.user ? req.user.id : null,
      customization: {
        pageColor: customization.pageColor || '#FFFFFF',
        textColor: customization.textColor || '#000000',
        textFont: customization.textFont || 'Arial',
        textSize: customization.textSize || 16,
        allowResponse: customization.allowResponse !== undefined ? customization.allowResponse : allowResponse,
        title: customization.title || '',
        textAlignment: customization.textAlignment || 'left',
        lineHeight: customization.lineHeight || 1.5,
        padding: customization.padding || 20,
        borderRadius: customization.borderRadius || 0,
        boxShadow: customization.boxShadow || false,
      },
      tags: Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string' && tag.trim()) : [],
      analyticsPrivate: Boolean(analyticsPrivate),
      expirationDate: expirationDate ? new Date(expirationDate) : null,
    };

    // Create new text page
    const textPage = new TextPage(textPageData);

    // Set password if provided
    if (password && typeof password === 'string' && password.trim()) {
      textPage.setPassword(password.trim());
      if (passwordNote && typeof passwordNote === 'string') {
        textPage.passwordNote = passwordNote.trim();
      }
    }

    // Save text page
    await textPage.save();

    // Update user stats and create notification for authenticated users
    if (req.user) {
      try {
        const user = await User.findById(req.user.id);
        if (user) {
          await user.updateStats();
          // Add coins for creating text page
          await user.addCoins(20, 'text_page_created').catch(err => {
            logger.warn('Failed to add coins for text page creation:', err.message);
          });
          
          // Create notification
          await Notification.createNotification(user._id, { 
            type: 'text_created', 
            title: 'Text Page Created', 
            message: `Your text page /${alias} has been created`, 
            data: { alias, textId: textPage._id } 
          }).catch(err => {
            logger.warn('Failed to create notification:', err.message);
          });
        }
      } catch (userError) {
        logger.warn('User update/notification error:', userError.message);
        // Don't fail the whole request if user updates fail
      }
    }

    // Return success response
    res.status(201).json({ 
      success: true, 
      message: 'Text page created successfully',
      data: { 
        textPage: {
          _id: textPage._id,
          alias: textPage.alias,
          shortUrl: textPage.shortUrl,
          textContent: textPage.textContent,
          customization: textPage.customization,
          analyticsUrl: textPage.analyticsUrl,
          analyticsPrivate: textPage.analyticsPrivate,
          expirationDate: textPage.expirationDate,
          passwordProtected: !!textPage.password,
          createdAt: textPage.createdAt,
          metadata: textPage.metadata,
          isPublic: !req.user,
        }
      } 
    });
  } catch (error) {
    logger.error('createTextPage error:', error);
    
    // Handle specific Mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed',
        errors: messages 
      });
    }
    
    // Handle duplicate key error (alias already exists in TextPage collection)
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Alias already taken',
        field: 'customAlias' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create text page',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get all text pages for user
exports.getAllTextPages = async (req, res) => {
  try {
    const query = { owner: req.user.id };
    const pages = await TextPage.find(query).sort({ createdAt: -1 }).lean();
    
    // Format response
    const formattedPages = pages.map(page => ({
      ...page,
      analyticsUrl: page.analyticsUrl,
      passwordProtected: !!page.password,
      isPublic: !page.owner,
    }));
    
    res.json({ 
      success: true, 
      data: formattedPages 
    });
  } catch (error) {
    logger.error('getAllTextPages error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch text pages' 
    });
  }
};

// Get a text page by alias
exports.getTextPage = async (req, res) => {
  try {
    const { alias } = req.params;
    const { password } = req.body;
    
    const textPage = await TextPage.findOne({ alias }).select('+password');
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    // Check if text page is active
    if (!textPage.active) {
      return res.status(403).json({ 
        success: false, 
        message: 'Text page is paused' 
      });
    }

    // Check if text page is restricted
    if (textPage.restricted) {
      return res.status(403).json({ 
        success: false, 
        message: 'Text page is restricted' 
      });
    }

    // Check if text page has expired
    if (textPage.expirationDate && new Date() > textPage.expirationDate) {
      return res.status(403).json({ 
        success: false, 
        message: 'Text page has expired' 
      });
    }

    // Check password if required
    if (textPage.password) {
      if (!password) {
        return res.status(401).json({ 
          success: false, 
          message: 'Password required', 
          requiresPassword: true, 
          passwordNote: textPage.passwordNote 
        });
      }
      
      if (!textPage.checkPassword(password)) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid password', 
          requiresPassword: true 
        });
      }
    }

    // Track analytics
    try {
      const analyticsData = await analyticsService.trackAnalytics({ 
        alias: textPage.alias, 
        type: 'text', 
        owner: textPage.owner 
      }, req);
      
      await textPage.incrementViews(analyticsData.isUnique);
    } catch (analyticsError) {
      logger.warn('Analytics tracking error:', analyticsError.message);
      // Don't fail the request if analytics fails
    }

    // Remove password from response
    const textPageResponse = textPage.toObject();
    delete textPageResponse.password;
    
    res.json({ 
      success: true, 
      data: { 
        textPage: textPageResponse 
      } 
    });
  } catch (error) {
    logger.error('getTextPage error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch text page' 
    });
  }
};

// Update a text page
exports.updateTextPage = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const textPage = await TextPage.findOne({ _id: id, owner: req.user.id });
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    // Handle password update
    if (updateData.password !== undefined) {
      if (!updateData.password || updateData.password.trim() === '') {
        textPage.setPassword(null);
        textPage.passwordNote = null;
      } else {
        textPage.setPassword(updateData.password);
        if (updateData.passwordNote) {
          textPage.passwordNote = updateData.passwordNote;
        }
      }
      delete updateData.password;
      delete updateData.passwordNote;
    }

    // Update fields
    Object.keys(updateData).forEach(key => {
      if (key === 'customization' && typeof updateData.customization === 'object') {
        // Merge customization object
        textPage.customization = { 
          ...textPage.customization, 
          ...updateData.customization 
        };
      } else if (key !== 'password' && key !== 'passwordNote') {
        textPage[key] = updateData[key];
      }
    });

    await textPage.save();
    
    res.json({ 
      success: true, 
      message: 'Text page updated successfully',
      data: { 
        textPage: {
          _id: textPage._id,
          alias: textPage.alias,
          shortUrl: textPage.shortUrl,
          customization: textPage.customization,
          active: textPage.active,
          restricted: textPage.restricted,
          updatedAt: textPage.updatedAt,
        }
      } 
    });
  } catch (error) {
    logger.error('updateTextPage error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update text page' 
    });
  }
};

// Delete a text page
exports.deleteTextPage = async (req, res) => {
  try {
    const { id } = req.params;
    
    const textPage = await TextPage.findOne({ _id: id, owner: req.user.id });
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    await TextPage.findByIdAndDelete(id);

    // Update user stats
    if (req.user) {
      try {
        const user = await User.findById(req.user.id);
        if (user) {
          await user.updateStats();
        }
      } catch (userError) {
        logger.warn('User update error during delete:', userError.message);
      }
    }

    res.json({ 
      success: true, 
      message: 'Text page deleted successfully' 
    });
  } catch (error) {
    logger.error('deleteTextPage error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete text page' 
    });
  }
};

// Add a reply to a text page
exports.addReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, message } = req.body;
    
    const textPage = await TextPage.findById(id);
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    // Check if responses are allowed
    if (!textPage.customization?.allowResponse) {
      return res.status(403).json({ 
        success: false, 
        message: 'Responses not allowed for this page' 
      });
    }

    // Validate reply data
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required' 
      });
    }

    const replyData = {
      user: req.user ? req.user.id : null,
      name: name || (req.user ? req.user.username : 'Anonymous') || 'Anonymous',
      email: email || null,
      message: message.trim(),
      approved: textPage.owner ? false : true, // Auto-approve if no owner
    };

    const savedReply = await textPage.addReply(replyData);

    // Notify owner (if different from replier)
    if (textPage.owner && textPage.owner.toString() !== (req.user ? req.user.id : null)) {
      try {
        await Notification.createNotification(textPage.owner, { 
          type: 'new_reply', 
          title: 'New Reply', 
          message: `New reply on /${textPage.alias}`, 
          data: { 
            reply: savedReply,
            textPageId: textPage._id,
            alias: textPage.alias
          } 
        });
      } catch (notifyError) {
        logger.warn('Failed to create notification for reply:', notifyError.message);
      }
    }

    res.json({ 
      success: true, 
      message: 'Reply added successfully',
      data: savedReply 
    });
  } catch (error) {
    logger.error('addReply error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to add reply' 
    });
  }
};

// Get replies for a text page (owner only)
exports.getReplies = async (req, res) => {
  try {
    const { id } = req.params;
    
    const textPage = await TextPage.findOne({ _id: id, owner: req.user.id });
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    res.json({ 
      success: true, 
      data: { 
        replies: textPage.replies || [] 
      } 
    });
  } catch (error) {
    logger.error('getReplies error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch replies' 
    });
  }
};

// Delete a reply (owner only)
exports.deleteReply = async (req, res) => {
  try {
    const { id, replyId } = req.params;
    
    const textPage = await TextPage.findOne({ _id: id, owner: req.user.id });
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    await textPage.deleteReply(replyId);
    
    res.json({ 
      success: true, 
      message: 'Reply deleted successfully' 
    });
  } catch (error) {
    logger.error('deleteReply error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete reply' 
    });
  }
};

// Approve / toggle reply approval (owner only)
exports.toggleReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { replyId } = req.body;
    
    const textPage = await TextPage.findOne({ _id: id, owner: req.user.id });
    
    if (!textPage) {
      return res.status(404).json({ 
        success: false, 
        message: 'Text page not found' 
      });
    }

    const reply = await textPage.approveReply(replyId);
    
    res.json({ 
      success: true, 
      message: 'Reply approved successfully',
      data: reply 
    });
  } catch (error) {
    logger.error('toggleReply error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to toggle reply' 
    });
  }
};