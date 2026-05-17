require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Movie = require('../backend/models/Movie');

const MONGODB_URI = process.env.MONGODB_URI;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in the environment.");
  process.exit(1);
}

if (!TMDB_API_KEY) {
  console.error("❌ TMDB_API_KEY is not defined in the environment.");
  process.exit(1);
}

// 2. CONFIGURE THE TMDB AXIOS PIPELINE
const tmdbClient = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: {
    api_key: TMDB_API_KEY
  }
});

// 3. DATA MAPPING AND UPSERT LOGIC
async function processMovies(moviesArray, category = 'movie') {
  let upsertedCount = 0;

  for (const movie of moviesArray) {
    // Safety Filter: Skip any movie where poster_path or backdrop_path is null.
    if (!movie.poster_path || !movie.backdrop_path) {
      console.log(`[SKIP] Missing imagery for: ${movie.title || movie.id}`);
      continue;
    }

    const releaseYear = movie.release_date ? parseInt(movie.release_date.split('-')[0], 10) : null;
    const views = (movie.vote_count || 0) * 10;

    const mappedData = {
      title: movie.title,
      tmdbId: movie.id,
      releaseYear: releaseYear,
      averageRating: movie.vote_average,
      views: views,
      thumbnailUrl: `https://wsrv.nl/?url=https://image.tmdb.org/t/p/w780${movie.poster_path}`,
      bannerUrl: `https://wsrv.nl/?url=https://image.tmdb.org/t/p/original${movie.backdrop_path}`,
      category: category,
      isBroadcasted: false
    };

    try {
      await Movie.updateOne(
        { tmdbId: movie.id },
        { $set: mappedData },
        { upsert: true }
      );
      upsertedCount++;
    } catch (err) {
      console.error(`❌ Error upserting movie ${movie.title}:`, err.message);
    }
  }

  return upsertedCount;
}

// 4. EXECUTION FLOW
async function runSeed() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ Connected to MongoDB");

    console.log('🧹 Wiping old metadata to prevent key conflicts...');
    await Movie.deleteMany({}); // Clears the collection completely
    console.log('✨ Database cleared. Starting clean premium import...');
    let totalUpserted = 0;

    console.log("\n📡 Fetching Endpoint 1: Trending Movies (Week)...");
    const trendingRes = await tmdbClient.get('/trending/movie/week');
    const trendingCount = await processMovies(trendingRes.data.results, 'movie');
    totalUpserted += trendingCount;
    console.log(`✅ Upserted ${trendingCount} trending movies.`);

    console.log("\n📡 Fetching Endpoint 2: Top Rated Movies...");
    const topRatedRes = await tmdbClient.get('/movie/top_rated');
    const topRatedCount = await processMovies(topRatedRes.data.results, 'movie');
    totalUpserted += topRatedCount;
    console.log(`✅ Upserted ${topRatedCount} top rated movies.`);

    console.log("\n📡 Fetching Endpoint 3: Modern Discover (2024)...");
    const discoverRes = await tmdbClient.get('/discover/movie', {
      params: {
        primary_release_year: 2024,
        sort_by: 'popularity.desc'
      }
    });
    const discoverCount = await processMovies(discoverRes.data.results, 'movie');
    totalUpserted += discoverCount;
    console.log(`✅ Upserted ${discoverCount} modern discover movies.`);

    console.log(`\n🎉 SEED COMPLETE! Successfully upserted ${totalUpserted} premium movies into the database.`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal Error during seeding:", error.message);
    process.exit(1);
  }
}

runSeed();
