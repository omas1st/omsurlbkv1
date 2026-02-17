// controllers/adminController.js
const User = require('../models/User');
const Url = require('../models/Url');
const AdminLog = require('../models/AdminLog');
const Notification = require('../models/Notification');
const logger = require('../utils/logger');

exports.listUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const skip = (page - 1) * limit;
    const query = {};
    if (search) {
      query.$or = [{ username: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }];
    }
    const users = await User.find(query).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)).select('-password -refreshToken');
    const total = await User.countDocuments(query);
    res.json({ success: true, data: { users, pagination: { page: parseInt(page), limit: parseInt(limit), total } } });
  } catch (error) {
    logger.error('listUsers error:', error);
    res.status(500).json({ success: false, message: 'Failed to list users' });
  }
};

exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -refreshToken');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (error) {
    logger.error('getUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    await AdminLog.logAction(req.user._id, { action: 'user_updated', targetType: 'user', targetId: user._id, changes: updates });
    res.json({ success: true, message: 'User updated', data: user });
  } catch (error) {
    logger.error('updateUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await AdminLog.logAction(req.user._id, { action: 'user_deleted', targetType: 'user', targetId: req.params.id });
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    logger.error('deleteUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
};

exports.restrictUser = async (req, res) => {
  try {
    const { reason, expireInDays } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isRestricted = true;
    user.restrictionReason = reason || 'Restricted by admin';
    user.restrictionExpires = expireInDays ? new Date(Date.now() + expireInDays * 24 * 60 * 60 * 1000) : null;
    await user.save();
    await Notification.createNotification(user._id, { type: 'user_restricted', title: 'Account Restricted', message: reason || 'Your account has been restricted', important: true });
    await AdminLog.logAction(req.user._id, { action: 'user_restricted', targetType: 'user', targetId: user._id, changes: { reason, restrictionExpires: user.restrictionExpires } });
    res.json({ success: true, message: 'User restricted' });
  } catch (error) {
    logger.error('restrictUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to restrict user' });
  }
};

exports.unrestrictUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isRestricted = false;
    user.restrictionReason = null;
    user.restrictionExpires = null;
    await user.save();
    await Notification.createNotification(user._id, { type: 'user_restricted', title: 'Account Unrestricted', message: 'Your account access has been restored' });
    await AdminLog.logAction(req.user._id, { action: 'user_unrestricted', targetType: 'user', targetId: user._id });
    res.json({ success: true, message: 'User unrestricted' });
  } catch (error) {
    logger.error('unrestrictUser error:', error);
    res.status(500).json({ success: false, message: 'Failed to unrestrict user' });
  }
};

exports.listUrls = async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const skip = (page - 1) * limit;
    const query = {};
    if (search) query.$or = [{ alias: { $regex: search, $options: 'i' } }, { longUrl: { $regex: search, $options: 'i' } }];
    const urls = await Url.find(query)
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .populate('owner', 'username email')   // <-- added populate
      .lean();
    const total = await Url.countDocuments(query);
    res.json({ success: true, data: { urls, pagination: { page: parseInt(page), limit: parseInt(limit), total } } });
  } catch (error) {
    logger.error('listUrls error:', error);
    res.status(500).json({ success: false, message: 'Failed to list urls' });
  }
};

exports.getUrl = async (req, res) => {
  try {
    const url = await Url.findById(req.params.id).lean();
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    res.json({ success: true, data: url });
  } catch (error) {
    logger.error('getUrl error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch url' });
  }
};

exports.restrictUrl = async (req, res) => {
  try {
    const { reason } = req.body;
    const url = await Url.findById(req.params.id);
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    url.restricted = true;
    url.restrictionReason = reason || 'Restricted by admin';
    await url.save();
    await AdminLog.logAction(req.user._id, { action: 'url_restricted', targetType: 'url', targetId: url._id, changes: { reason } });
    res.json({ success: true, message: 'URL restricted' });
  } catch (error) {
    logger.error('restrictUrl error:', error);
    res.status(500).json({ success: false, message: 'Failed to restrict url' });
  }
};

exports.unrestrictUrl = async (req, res) => {
  try {
    const url = await Url.findById(req.params.id);
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    url.restricted = false;
    url.restrictionReason = null;
    await url.save();
    await AdminLog.logAction(req.user._id, { action: 'url_unrestricted', targetType: 'url', targetId: url._id });
    res.json({ success: true, message: 'URL unrestricted' });
  } catch (error) {
    logger.error('unrestrictUrl error:', error);
    res.status(500).json({ success: false, message: 'Failed to unrestrict url' });
  }
};

exports.getAdminStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalUrls = await Url.countDocuments();
    const totalClicksAgg = await Url.aggregate([{ $group: { _id: null, clicks: { $sum: '$clicks' } } }]);
    const totalClicks = totalClicksAgg[0]?.clicks || 0;
    const activeUsers = await User.countDocuments({ isRestricted: false }); // assuming active means not restricted
    const restrictedUrls = await Url.countDocuments({ restricted: true });

    res.json({
      success: true,
      data: {
        totalUsers,
        totalUrls,
        totalClicks,
        activeUsers,
        restrictedUrls
      }
    });
  } catch (error) {
    logger.error('getAdminStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admin stats' });
  }
};

exports.systemHealth = async (req, res) => {
  try {
    res.json({ success: true, status: 'ok', environment: process.env.NODE_ENV || 'development', time: new Date() });
  } catch (error) {
    logger.error('systemHealth error:', error);
    res.status(500).json({ success: false, message: 'Failed to get system health' });
  }
};

exports.serverInfo = async (req, res) => {
  try {
    const info = { nodeVersion: process.version, platform: process.platform, memory: process.memoryUsage(), uptime: process.uptime() };
    res.json({ success: true, data: info });
  } catch (error) {
    logger.error('serverInfo error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch server info' });
  }
};

// Remaining admin endpoints can be implemented similarly (placeholders)
exports.getSettings = async (req, res) => res.json({ success: true, data: { message: 'Not implemented: admin settings store' } });
exports.updateSettings = async (req, res) => res.json({ success: true, message: 'Settings updated (placeholder)' });
exports.getLogs = async (req, res) => res.json({ success: true, data: { message: 'Logs retrieval not implemented in this endpoint' } });
exports.clearLogs = async (req, res) => res.json({ success: true, message: 'Logs cleared (placeholder)' });
exports.backup = async (req, res) => res.json({ success: false, message: 'Backup endpoint not implemented' });
exports.restore = async (req, res) => res.json({ success: false, message: 'Restore endpoint not implemented' });
exports.sendEmail = async (req, res) => res.json({ success: false, message: 'Email send endpoint not implemented' });
exports.emailTemplates = async (req, res) => res.json({ success: true, data: [] });
exports.updateEmailTemplate = async (req, res) => res.json({ success: true, message: 'Updated (placeholder)' });
exports.generateReport = async (req, res) => res.json({ success: false, message: 'Reports not implemented' });
exports.getReports = async (req, res) => res.json({ success: true, data: [] });
exports.getReport = async (req, res) => res.json({ success: false, message: 'Not implemented' });
exports.clearCache = async (req, res) => res.json({ success: true, message: 'Cache cleared (placeholder)' });
exports.maintenanceMode = async (req, res) => res.json({ success: true, message: 'Maintenance toggled (placeholder)' });
exports.updateSystem = async (req, res) => res.json({ success: true, message: 'System update triggered (placeholder)' });