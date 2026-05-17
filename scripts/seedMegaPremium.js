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

const tmdbClient = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: {
    api_key: TMDB_API_KEY
  }
});

// A helper delay to be extremely friendly to TMDB API rate-limits
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runMegaSeed() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ Connected to MongoDB");

    // We do NOT wipe the database to prevent losing existing custom seeds.
    // Instead, we will upsert everything cleanly based on TMDB ID, completely preventing duplicates!
    console.log("📡 Pre-scanning existing movies in database to prevent duplicates...");
    const existingMovies = await Movie.find({}, { tmdbId: 1 }).lean();
    const existingIds = new Set(existingMovies.map(m => m.tmdbId));
    console.log(`ℹ️ Found ${existingIds.size} existing movies in the database.`);

    const uniqueMoviesMap = new Map();

    // ── ENDPOINTS TO CRAWL ──
    // 1. Popular Movies: 130 Pages (2600 movies)
    // 2. Top Rated Movies: 130 Pages (2600 movies)
    // 3. Modern Discover Movies (2022 to 2025): 45 Pages each (3600 movies)
    
    const tasks = [
      { name: 'Popular Movies', path: '/movie/popular', pages: 130, params: {} },
      { name: 'Top Rated Movies', path: '/movie/top_rated', pages: 130, params: {} },
      { name: 'Discover 2025', path: '/discover/movie', pages: 45, params: { primary_release_year: 2025, sort_by: 'popularity.desc' } },
      { name: 'Discover 2024', path: '/discover/movie', pages: 45, params: { primary_release_year: 2024, sort_by: 'popularity.desc' } },
      { name: 'Discover 2023', path: '/discover/movie', pages: 45, params: { primary_release_year: 2023, sort_by: 'popularity.desc' } },
      { name: 'Discover 2022', path: '/discover/movie', pages: 45, params: { primary_release_year: 2022, sort_by: 'popularity.desc' } }
    ];

    console.log("\n🚀 Starting Multi-Endpoint Crawling Sequence for 5,000+ Movies...");

    for (const task of tasks) {
      console.log(`\n⏳ Crawling ${task.name} (${task.pages} pages)...`);
      
      for (let page = 1; page <= task.pages; page++) {
        try {
          const response = await tmdbClient.get(task.path, {
            params: {
              ...task.params,
              page
            }
          });

          const results = response.data.results || [];
          if (results.length === 0) {
            console.log(`   [INFO] Reached end of results at page ${page} for ${task.name}`);
            break;
          }

          let addedInPage = 0;
          for (const movie of results) {
            // Safety requirements:
            if (!movie.id || !movie.title || !movie.poster_path || !movie.backdrop_path) {
              continue;
            }

            // Exclude already existing or already processed in this run
            if (uniqueMoviesMap.has(movie.id)) {
              continue;
            }

            const releaseYear = movie.release_date ? parseInt(movie.release_date.split('-')[0], 10) : null;
            const views = (movie.vote_count || 0) * 10;
            const rawPosterUrl = `https://image.tmdb.org/t/p/w780${movie.poster_path}`;
            const rawBannerUrl = `https://image.tmdb.org/t/p/original${movie.backdrop_path}`;

            uniqueMoviesMap.set(movie.id, {
              title: movie.title,
              tmdbId: movie.id,
              releaseYear: releaseYear,
              averageRating: movie.vote_average || 0,
              views: views,
              posterUrl: `https://wsrv.nl/?url=${encodeURIComponent(rawPosterUrl)}&output=webp`,
              thumbnailUrl: `https://wsrv.nl/?url=${encodeURIComponent(rawPosterUrl)}&output=webp`,
              bannerUrl: `https://wsrv.nl/?url=${encodeURIComponent(rawBannerUrl)}&output=webp`,
              category: 'movie',
              isBroadcasted: false,
              isFeatured: true
            });
            
            addedInPage++;
          }

          if (page % 15 === 0 || page === task.pages) {
            console.log(`   Page ${page}/${task.pages}: Processed. Total unique movies collected so far: ${uniqueMoviesMap.size}`);
          }

          // Strict rate-limiting pause to prevent API threshold triggers
          await delay(60);
        } catch (err) {
          console.error(`   ❌ Error fetching page ${page} of ${task.name}:`, err.message);
          // Wait longer on error before retrying
          await delay(1000);
        }
      }
    }

    const totalCollected = uniqueMoviesMap.size;
    console.log(`\n🎉 CRAWL COMPLETE! Collected ${totalCollected} unique eligible movies.`);

    if (totalCollected === 0) {
      console.log("ℹ️ No new movies to insert.");
      process.exit(0);
    }

    // ── PREPARE BULK WRITE OPERATIONS ──
    console.log("\n📦 Preparing Mongoose BulkWrite Operations...");
    const bulkOps = [];
    
    for (const [tmdbId, mappedData] of uniqueMoviesMap.entries()) {
      bulkOps.push({
        updateOne: {
          filter: { tmdbId: tmdbId },
          update: { $set: mappedData },
          upsert: true
        }
      });
    }

    console.log(`⚡ Executing BulkWrite of ${bulkOps.length} operations...`);
    const batchSize = 1000;
    let successfulUpserts = 0;

    for (let i = 0; i < bulkOps.length; i += batchSize) {
      const batch = bulkOps.slice(i, i + batchSize);
      console.log(`   Writing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(bulkOps.length / batchSize)} (${batch.length} items)...`);
      
      const result = await Movie.bulkWrite(batch, { ordered: false });
      successfulUpserts += (result.upsertedCount + result.modifiedCount);
      
      // Delay slightly between batches to keep MongoDB Atlas connection stable
      await delay(200);
    }

    console.log(`\n🏆 MEGA SEED SUCCESSFUL!`);
    console.log(`👉 Total unique movies fetched: ${totalCollected}`);
    console.log(`👉 Database successfully upserted/updated: ${successfulUpserts} records.`);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal Error during Mega Seed:", error.message);
    process.exit(1);
  }
}

runMegaSeed();
