require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const movies = db.collection('movies');

    const query = {
      $or: [
        { thumbnailUrl: null },
        { thumbnailUrl: '' },
        { thumbnailUrl: { $exists: false } },
        { thumbnailUrl: { $regex: /base64/i } } // Placeholder URLs if saved
      ]
    };

    const count = await movies.countDocuments(query);
    console.log(`Found ${count} movies missing thumbnails.`);

    if (count > 0) {
      const result = await movies.deleteMany(query);
      console.log(`Deleted ${result.deletedCount} movies successfully.`);
    }

  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    mongoose.disconnect();
  }
}

run();
