const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const Movie = require('./backend/models/Movie');
    
    // Delete any movie/anime where both posterUrl and thumbnailUrl are basically empty
    const result = await Movie.deleteMany({
      $or: [
        { thumbnailUrl: { $in: [null, '', 'N/A'] } },
        { thumbnailUrl: { $exists: false } },
        { posterUrl: { $in: [null, '', 'N/A'] } },
        { posterUrl: { $exists: false } }
      ]
    });
    
    console.log('Successfully deleted records without posters:', result.deletedCount);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
