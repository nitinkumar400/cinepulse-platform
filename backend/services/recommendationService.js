const mongoose = require('mongoose');
const Movie = require('../models/Movie');
const WatchHistory = require('../models/WatchHistory');

function scoreMovie(movie, profile) {
  let score = 0;

  const movieGenres = movie.genre || [];
  for (const genre of movieGenres) {
    score += (profile.genreWeights[genre] || 0) * 3;
  }

  score += (profile.categoryWeights[movie.category] || 0) * 2;
  score += Math.min(20, movie.views || 0) / 5;
  score += Math.min(15, movie.averageRating || 0) * 1.5;

  if (profile.seedGenres.some((genre) => movieGenres.includes(genre))) score += 8;
  if (profile.seedCategories.includes(movie.category)) score += 5;

  return score;
}

async function buildUserProfile(userId) {
  const history = await WatchHistory.find({ user: userId })
    .populate('movie', 'genre category title')
    .sort({ watchedAt: -1 })
    .limit(50);

  const validHistory = history.filter((entry) => entry.movie);
  const watchedMovieIds = validHistory.map((entry) => entry.movie._id.toString());
  const genreWeights = {};
  const categoryWeights = {};

  validHistory.forEach((entry, index) => {
    const freshnessBonus = Math.max(1, 10 - index);
    const completionBonus = entry.completed ? 4 : 1;
    const progressWeight = Math.max(1, Math.round((entry.percentWatched || 0) / 20));
    const totalWeight = freshnessBonus + completionBonus + progressWeight;

    (entry.movie.genre || []).forEach((genre) => {
      genreWeights[genre] = (genreWeights[genre] || 0) + totalWeight;
    });

    categoryWeights[entry.movie.category] = (categoryWeights[entry.movie.category] || 0) + totalWeight;
  });

  const seedGenres = Object.entries(genreWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre);

  const seedCategories = Object.entries(categoryWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);

  return {
    history: validHistory,
    watchedMovieIds,
    genreWeights,
    categoryWeights,
    seedGenres,
    seedCategories,
  };
}

async function getPersonalizedRecommendations(userId, limit = 12) {
  const profile = await buildUserProfile(userId);

  const baseFilter = profile.watchedMovieIds.length
    ? { _id: { $nin: profile.watchedMovieIds } }
    : {};

  let candidates;

  if (profile.seedGenres.length || profile.seedCategories.length) {
    candidates = await Movie.find({
      ...baseFilter,
      $or: [
        profile.seedGenres.length ? { genre: { $in: profile.seedGenres } } : null,
        profile.seedCategories.length ? { category: { $in: profile.seedCategories } } : null,
      ].filter(Boolean),
    })
      .limit(80)
      .select('title thumbnailUrl category genre releaseYear averageRating views duration _id');
  } else {
    candidates = await Movie.find(baseFilter)
      .sort({ views: -1, averageRating: -1, createdAt: -1 })
      .limit(limit)
      .select('title thumbnailUrl category genre releaseYear averageRating views duration _id');
  }

  const ranked = candidates
    .map((movie) => ({ movie, score: scoreMovie(movie, profile) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.movie);

  return {
    recommendations: ranked,
    basedOn: {
      genres: profile.seedGenres,
      categories: profile.seedCategories,
      watchedCount: profile.watchedMovieIds.length,
    },
    type: profile.seedGenres.length || profile.seedCategories.length ? 'personalized' : 'popular',
  };
}

async function getBecauseYouWatched(movieId, limit = 12) {
  const movie = await Movie.findById(movieId).select('title genre category _id');
  if (!movie) {
    const error = new Error('Movie not found');
    error.status = 404;
    throw error;
  }

  const genres = movie.genre || [];
  const pipeline = [
    {
      $match: {
        movie: new mongoose.Types.ObjectId(movieId),
      },
    },
    {
      $lookup: {
        from: 'watchhistories',
        localField: 'user',
        foreignField: 'user',
        as: 'relatedHistory',
      },
    },
    { $unwind: '$relatedHistory' },
    {
      $match: {
        'relatedHistory.movie': { $ne: new mongoose.Types.ObjectId(movieId) },
      },
    },
    {
      $group: {
        _id: '$relatedHistory.movie',
        coWatchCount: { $sum: 1 },
      },
    },
    { $sort: { coWatchCount: -1 } },
    { $limit: 20 },
  ];

  const relatedIds = await WatchHistory.aggregate(pipeline);
  const relatedMovies = relatedIds.length
    ? await Movie.find({ _id: { $in: relatedIds.map((entry) => entry._id) } })
      .select('title thumbnailUrl category genre releaseYear averageRating views duration _id')
    : [];

  const relatedById = new Map(relatedIds.map((entry) => [String(entry._id), entry.coWatchCount]));
  const rankedRelated = relatedMovies
    .map((candidate) => {
      const sharedGenres = (candidate.genre || []).filter((genre) => genres.includes(genre)).length;
      return {
        movie: candidate,
        score: (relatedById.get(String(candidate._id)) || 0) * 5 + sharedGenres * 3 + (candidate.averageRating || 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.movie);

  if (rankedRelated.length < limit) {
    const fill = await Movie.find({
      _id: { $ne: movie._id, $nin: rankedRelated.map((entry) => entry._id) },
      $or: [
        { genre: { $in: genres } },
        { category: movie.category },
      ],
    })
      .sort({ averageRating: -1, views: -1 })
      .limit(limit - rankedRelated.length)
      .select('title thumbnailUrl category genre releaseYear averageRating views duration _id');

    rankedRelated.push(...fill);
  }

  return {
    recommendations: rankedRelated.slice(0, limit),
    basedOn: {
      title: movie.title,
      genre: genres,
      category: movie.category,
    },
  };
}

async function getTrendingRanked(limit = 10, category = '') {
  const match = category ? { category } : {};
  const recentWindow = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const movies = await Movie.find(match)
    .select('title thumbnailUrl category genre releaseYear averageRating views duration createdAt _id')
    .limit(100);

  const ranked = movies
    .map((movie) => {
      const freshness = movie.createdAt >= recentWindow ? 10 : 0;
      const score = (movie.views || 0) * 0.6 + (movie.averageRating || 0) * 8 + freshness;
      return { movie, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.movie);

  return ranked;
}

module.exports = {
  buildUserProfile,
  getPersonalizedRecommendations,
  getBecauseYouWatched,
  getTrendingRanked,
};
