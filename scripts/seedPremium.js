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

    const rawPosterUrl = `https://image.tmdb.org/t/p/w780${movie.poster_path}`;
    const rawBannerUrl = `https://image.tmdb.org/t/p/original${movie.backdrop_path}`;

    const mappedData = {
      title: movie.title,
      tmdbId: movie.id,
      releaseYear: releaseYear,
      averageRating: movie.vote_average,
      views: views,
      posterUrl: `https://wsrv.nl/?url=${encodeURIComponent(rawPosterUrl)}&output=webp`,
      thumbnailUrl: `https://wsrv.nl/?url=${encodeURIComponent(rawPosterUrl)}&output=webp`,
      bannerUrl: `https://wsrv.nl/?url=${encodeURIComponent(rawBannerUrl)}&output=webp`,
      category: category,
      isBroadcasted: false,
      isFeatured: true
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

    // 1. Trending Matrix: Pages 1 to 3
    console.log("\n📡 Fetching Endpoint 1: Trending Movies (Week) Pages 1-3...");
    for (let page = 1; page <= 3; page++) {
      try {
        const trendingRes = await tmdbClient.get('/trending/movie/week', { params: { page } });
        const trendingCount = await processMovies(trendingRes.data.results, 'movie');
        totalUpserted += trendingCount;
        console.log(`   Page ${page}: Upserted ${trendingCount} trending movies.`);
      } catch (err) {
        console.error(`   Error fetching Trending Page ${page}:`, err.message);
      }
    }

    // 2. Top Rated Matrix: Pages 1 and 2, ensuring vote_average >= 7.5
    console.log("\n📡 Fetching Endpoint 2: Top Rated Movies Pages 1-2 (Rating >= 7.5)...");
    for (let page = 1; page <= 2; page++) {
      try {
        const topRatedRes = await tmdbClient.get('/movie/top_rated', { params: { page } });
        const filtered = (topRatedRes.data.results || []).filter(movie => movie.vote_average >= 7.5);
        const topRatedCount = await processMovies(filtered, 'movie');
        totalUpserted += topRatedCount;
        console.log(`   Page ${page}: Upserted ${topRatedCount} top rated movies.`);
      } catch (err) {
        console.error(`   Error fetching Top Rated Page ${page}:`, err.message);
      }
    }

    // 3. Latest Discover Matrix: Pages 1 to 3, year 2025
    console.log("\n📡 Fetching Endpoint 3: Modern Discover (2025) Pages 1-3...");
    for (let page = 1; page <= 3; page++) {
      try {
        const discoverRes = await tmdbClient.get('/discover/movie', {
          params: {
            primary_release_year: 2025,
            sort_by: 'popularity.desc',
            page
          }
        });
        const discoverCount = await processMovies(discoverRes.data.results, 'movie');
        totalUpserted += discoverCount;
        console.log(`   Page ${page}: Upserted ${discoverCount} modern discover movies.`);
      } catch (err) {
        console.error(`   Error fetching Discover Page ${page}:`, err.message);
      }
    }

    console.log(`\n🎉 SEED COMPLETE! Successfully upserted ${totalUpserted} premium movies into the database.`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal Error during seeding:", error.message);
    process.exit(1);
  }
}

runSeed();
