const express = require('express');
const router = express.Router();

const { getBecauseYouWatched, getPersonalizedRecommendations } = require('../services/recommendationService');
const { sendSuccess, asyncHandler } = require('../utils/apiResponse');
const { protect } = require('../middleware/authMiddleware');

router.get('/for-you/list', protect, asyncHandler(async (req, res) => {
  const payload = await getPersonalizedRecommendations(req.user._id, parseInt(req.query.limit, 10) || 12);
  return sendSuccess(res, payload, { message: 'Personalized recommendations loaded' });
}));

router.get('/:movieId', asyncHandler(async (req, res) => {
  const payload = await getBecauseYouWatched(req.params.movieId, parseInt(req.query.limit, 10) || 12);
  return sendSuccess(res, payload, { message: 'Recommendations loaded' });
}));

module.exports = router;
