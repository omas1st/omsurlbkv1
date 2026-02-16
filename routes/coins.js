// routes/coins.js
const express = require('express');
const router = express.Router();
const coinController = require('../controllers/coinController');
const { protect } = require('../middleware/auth');

router.get('/balance', protect, coinController.getBalance);
router.get('/history', protect, coinController.getHistory);
router.post('/earn', protect, coinController.earnCoins);
router.post('/spend', protect, coinController.spendCoins);
router.post('/transfer', protect, coinController.transferCoins);
router.get('/rewards', protect, coinController.getRewards);
router.post('/redeem', protect, coinController.redeemReward);
router.get('/referral', protect, coinController.getReferralCode);
router.post('/referral/generate', protect, coinController.generateReferralCode);
router.get('/referral/stats', protect, coinController.getReferralStats);
router.post('/referral/claim', protect, coinController.claimReferralBonus);
router.get('/tasks/daily', protect, coinController.getDailyTasks);
router.post('/tasks/complete', protect, coinController.completeTask);
router.get('/achievements', protect, coinController.getAchievements);
router.post('/achievements/claim', protect, coinController.claimAchievement);
router.get('/premium/plans', protect, coinController.getPremiumPlans);
router.post('/premium/subscribe', protect, coinController.subscribePremium);
router.get('/premium/subscription', protect, coinController.getCurrentSubscription);
router.post('/premium/cancel', protect, coinController.cancelSubscription);
router.get('/packages', protect, coinController.getCoinPackages);
router.post('/purchase', protect, coinController.purchaseCoins);
router.post('/verify-payment', protect, coinController.verifyPayment);
router.get('/transaction/:id', protect, coinController.getTransaction);
router.get('/leaderboard', protect, coinController.getLeaderboard);
router.get('/value', protect, coinController.getCoinValue);

module.exports = router;
