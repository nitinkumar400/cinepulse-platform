require('dotenv').config();
const mongoose = require('mongoose');
const Movie = require('../backend/models/Movie');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI is not defined in the environment.");
  process.exit(1);
}

async function runUpdate() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ Connected to MongoDB");

    const result = await Movie.updateMany({}, { $set: { isFeatured: true } });
    console.log(`\n🎉 Successfully updated ${result.modifiedCount} movies to isFeatured: true!`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during update:", error.message);
    process.exit(1);
  }
}

runUpdate();
