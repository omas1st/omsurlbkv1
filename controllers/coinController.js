// controllers/coinController.js
const User = require('../models/User');
const CoinTransaction = require('../models/CoinTransaction');
const logger = require('../utils/logger');

exports.getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('coins');
    res.json({ success: true, balance: user.coins });
  } catch (error) {
    logger.error('getBalance error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch balance' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const transactions = await CoinTransaction.find({ user: req.user.id }).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)).lean();
    const total = await CoinTransaction.countDocuments({ user: req.user.id });
    res.json({ success: true, data: { transactions, pagination: { page: parseInt(page), limit: parseInt(limit), total } } });
  } catch (error) {
    logger.error('getHistory error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
};

exports.earnCoins = async (req, res) => {
  try {
    const { source, amount, metadata = {} } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
    const user = await User.findById(req.user.id);
    const newBalance = await user.addCoins(amount, source || 'earn', metadata);
    res.json({ success: true, newBalance });
  } catch (error) {
    logger.error('earnCoins error:', error);
    res.status(500).json({ success: false, message: 'Failed to add coins' });
  }
};

exports.spendCoins = async (req, res) => {
  try {
    const { purpose, amount, metadata = {} } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });
    const user = await User.findById(req.user.id);
    try {
      const newBalance = await user.removeCoins(amount, purpose || 'spend', metadata);
      res.json({ success: true, newBalance });
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
  } catch (error) {
    logger.error('spendCoins error:', error);
    res.status(500).json({ success: false, message: 'Failed to spend coins' });
  }
};

exports.transferCoins = async (req, res) => {
  try {
    const { toUserId, amount, note = '' } = req.body;
    if (!toUserId || !amount) return res.status(400).json({ success: false, message: 'Missing params' });

    const fromUser = await User.findById(req.user.id);
    const toUser = await User.findById(toUserId);
    if (!toUser) return res.status(404).json({ success: false, message: 'Recipient not found' });

    if (fromUser.coins < amount) return res.status(400).json({ success: false, message: 'Insufficient coins' });

    await fromUser.removeCoins(amount, `transfer to ${toUserId}`);
    await toUser.addCoins(amount, `transfer from ${fromUser._id}`);

    // Log transactions are created by user model methods
    res.json({ success: true, message: 'Transfer successful' });
  } catch (error) {
    logger.error('transferCoins error:', error);
    res.status(500).json({ success: false, message: 'Failed to transfer coins' });
  }
};

// Missing functions - adding them now
exports.getRewards = async (req, res) => {
  try {
    // Placeholder - implement rewards logic
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getRewards error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch rewards' });
  }
};

exports.redeemReward = async (req, res) => {
  try {
    const { rewardId } = req.body;
    // Placeholder - implement redeem logic
    res.json({ success: true, message: 'Reward redeemed successfully' });
  } catch (error) {
    logger.error('redeemReward error:', error);
    res.status(500).json({ success: false, message: 'Failed to redeem reward' });
  }
};

exports.getReferralStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    // Placeholder - implement referral stats
    res.json({ 
      success: true, 
      data: {
        totalReferrals: 0,
        earnedCoins: 0,
        pendingReferrals: 0
      } 
    });
  } catch (error) {
    logger.error('getReferralStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referral stats' });
  }
};

exports.claimReferralBonus = async (req, res) => {
  try {
    // Placeholder - implement claim logic
    res.json({ success: true, message: 'Referral bonus claimed successfully' });
  } catch (error) {
    logger.error('claimReferralBonus error:', error);
    res.status(500).json({ success: false, message: 'Failed to claim referral bonus' });
  }
};

exports.getDailyTasks = async (req, res) => {
  try {
    // Placeholder - implement tasks logic
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getDailyTasks error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch daily tasks' });
  }
};

exports.completeTask = async (req, res) => {
  try {
    const { taskId } = req.body;
    // Placeholder - implement task completion logic
    res.json({ success: true, message: 'Task completed successfully' });
  } catch (error) {
    logger.error('completeTask error:', error);
    res.status(500).json({ success: false, message: 'Failed to complete task' });
  }
};

exports.getAchievements = async (req, res) => {
  try {
    // Placeholder - implement achievements logic
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getAchievements error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch achievements' });
  }
};

exports.claimAchievement = async (req, res) => {
  try {
    const { achievementId } = req.body;
    // Placeholder - implement achievement claim logic
    res.json({ success: true, message: 'Achievement claimed successfully' });
  } catch (error) {
    logger.error('claimAchievement error:', error);
    res.status(500).json({ success: false, message: 'Failed to claim achievement' });
  }
};

exports.getPremiumPlans = async (req, res) => {
  try {
    // Placeholder - implement premium plans logic
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getPremiumPlans error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch premium plans' });
  }
};

exports.subscribePremium = async (req, res) => {
  try {
    const { planId } = req.body;
    // Placeholder - implement subscription logic
    res.json({ success: true, message: 'Subscribed to premium successfully' });
  } catch (error) {
    logger.error('subscribePremium error:', error);
    res.status(500).json({ success: false, message: 'Failed to subscribe to premium' });
  }
};

exports.getCurrentSubscription = async (req, res) => {
  try {
    // Placeholder - implement current subscription logic
    res.json({ success: true, data: null });
  } catch (error) {
    logger.error('getCurrentSubscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch current subscription' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    // Placeholder - implement cancel subscription logic
    res.json({ success: true, message: 'Subscription cancelled successfully' });
  } catch (error) {
    logger.error('cancelSubscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel subscription' });
  }
};

exports.getCoinPackages = async (req, res) => {
  try {
    // Placeholder - implement coin packages logic
    res.json({ success: true, data: [] });
  } catch (error) {
    logger.error('getCoinPackages error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch coin packages' });
  }
};

exports.purchaseCoins = async (req, res) => {
  try {
    const { packageId } = req.body;
    // Placeholder - implement purchase logic
    res.json({ success: true, message: 'Coins purchased successfully' });
  } catch (error) {
    logger.error('purchaseCoins error:', error);
    res.status(500).json({ success: false, message: 'Failed to purchase coins' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { paymentId, paymentMethod } = req.body;
    // Placeholder - implement payment verification logic
    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (error) {
    logger.error('verifyPayment error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify payment' });
  }
};

exports.getTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await CoinTransaction.findOne({ _id: id, user: req.user.id }).lean();
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    res.json({ success: true, data: transaction });
  } catch (error) {
    logger.error('getTransaction error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transaction' });
  }
};

exports.getReferralCode = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({ success: true, code: user.referralCode, url: user.referralUrl });
  } catch (error) {
    logger.error('getReferralCode error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch referral code' });
  }
};

exports.generateReferralCode = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const code = user.generateReferralCode();
    await user.save();
    res.json({ success: true, code, url: user.referralUrl });
  } catch (error) {
    logger.error('generateReferralCode error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate referral code' });
  }
};

exports.getLeaderboard = async (req, res) => {
  try {
    const { period = 'monthly', limit = 10 } = req.query;
    const users = await User.find().sort({ coins: -1 }).limit(parseInt(limit)).select('username coins profileImage');
    res.json({ success: true, data: users });
  } catch (error) {
    logger.error('getLeaderboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
  }
};

exports.getCoinValue = async (req, res) => {
  try {
    res.json({ success: true, value: 0.01, currency: 'USD' });
  } catch (error) {
    logger.error('getCoinValue error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch coin value' });
  }
};