require('dotenv').config();
const mongoose = require('mongoose');
const Movie = require('../backend/models/Movie');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in the environment.");
  process.exit(1);
}

async function runCheck() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ Connected to MongoDB");

    const totalCount = await Movie.countDocuments();
    console.log(`\n📊 Total movies/series in DB: ${totalCount}`);

    const categories = await Movie.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } }
    ]);
    console.log("\n📁 Counts by Category:");
    categories.forEach(c => {
      console.log(` - ${c._id || "undefined"}: ${c.count}`);
    });

    const isFeaturedCounts = await Movie.aggregate([
      { $group: { _id: "$isFeatured", count: { $sum: 1 } } }
    ]);
    console.log("\n⭐ Counts by isFeatured flag:");
    isFeaturedCounts.forEach(f => {
      console.log(` - ${f._id === undefined ? "undefined (treated as false)" : f._id}: ${f.count}`);
    });

    console.log("\n🔍 Sample of last 5 added movies/series:");
    const samples = await Movie.find().sort({ createdAt: -1 }).limit(5);
    samples.forEach((m, idx) => {
      console.log(`\n[${idx + 1}] Title: ${m.title}`);
      console.log(`    Category: ${m.category}`);
      console.log(`    TMDB ID: ${m.tmdbId}`);
      console.log(`    Release Year: ${m.releaseYear}`);
      console.log(`    Rating: ${m.averageRating}`);
      console.log(`    Thumbnail: ${m.thumbnailUrl}`);
      console.log(`    Banner: ${m.bannerUrl}`);
      console.log(`    isFeatured: ${m.isFeatured}`);
      console.log(`    isBroadcasted: ${m.isBroadcasted}`);
    });

    // Check for any formatting errors (nulls, missing poster paths, etc.)
    const missingImagery = await Movie.countDocuments({
      $or: [
        { thumbnailUrl: { $in: [null, ""] } },
        { bannerUrl: { $in: [null, ""] } }
      ]
    });
    console.log(`\n⚠️ Movies missing crucial imagery: ${missingImagery}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during check:", error.message);
    process.exit(1);
  }
}

runCheck();
