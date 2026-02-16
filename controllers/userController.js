// controllers/userController.js
const User = require('../models/User');
const Notification = require('../models/Notification');
const logger = require('../utils/logger');

exports.getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('settings');
    res.json({ success: true, data: user.settings });
  } catch (error) {
    logger.error('getSettings error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findById(req.user.id);
    user.settings = { ...user.settings.toObject(), ...updates };
    await user.save();
    res.json({ success: true, message: 'Settings updated', data: user.settings });
  } catch (error) {
    logger.error('updateSettings error:', error);
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: notifications });
  } catch (error) {
    logger.error('getNotifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { $set: { read: true } });
    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error) {
    logger.error('markNotificationsRead error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notifications read' });
  }
};

exports.getReferrals = async (req, res) => {
  try {
    const users = await User.find({ referredBy: req.user.id }).select('username email createdAt');
    res.json({ success: true, data: users });
  } catch (error) {
    logger.error('getReferrals error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
  }
};

exports.getActivity = async (req, res) => {
  try {
    // return basic activity: recent login date and counts
    const user = await User.findById(req.user.id).select('lastLogin lastActive loginCount stats');
    res.json({ success: true, data: user });
  } catch (error) {
    logger.error('getActivity error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch activity' });
  }
};
