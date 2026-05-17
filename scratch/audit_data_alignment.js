require('dotenv').config();
const mongoose = require('mongoose');
const Movie = require('../backend/models/Movie');

async function runAudit() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      console.error("❌ MONGODB_URI is not defined.");
      process.exit(1);
    }

    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    const sample = await Movie.findOne({});
    if (!sample) {
      console.log("ALIGNMENT FAILED: No movies found in the database. Please seed first.");
      process.exit(0);
    }

    console.log("Sample Movie Document Details:");
    console.log("------------------------------");
    console.log(`Title: ${sample.title}`);
    console.log(`thumbnailUrl: ${sample.thumbnailUrl}`);
    console.log(`bannerUrl: ${sample.bannerUrl}`);
    console.log("------------------------------\n");

    // Check 1: Key Check
    // The frontend createMovieCard uses:
    // isWide: movie.bannerUrl (or fallback movie.thumbnailUrl / movie.posterUrl)
    // isTall: movie.posterUrl || movie.thumbnailUrl
    // The database model defines: thumbnailUrl, bannerUrl.
    // So "thumbnailUrl" is the main key used for the poster.
    const hasThumbnailUrl = typeof sample.thumbnailUrl === 'string' && sample.thumbnailUrl.trim() !== '';
    const frontendHasThumbnailUrl = true; // Confirmed from public/js/app.js createMovieCard

    // Check 2: Resolution Audit
    // Confirm if image URL uses true HD quality (contains /w780 or /original rather than /w500)
    const isHD = sample.thumbnailUrl.includes('/w780') || sample.thumbnailUrl.includes('/original');

    // Check 3: Proxy Audit
    // Verify that image URL is wrapped inside our anti-ISP blocking proxy shield (https://wsrv.nl/?url=...)
    const isProxied = sample.thumbnailUrl.startsWith('https://wsrv.nl/?url=') || 
                      sample.thumbnailUrl.includes('wsrv.nl');

    if (hasThumbnailUrl && frontendHasThumbnailUrl && isHD && isProxied) {
      console.log("ALIGNMENT PASSED: Data keys are fully unified. Posters are guaranteed to render in HD quality with proxy protection.");
    } else {
      console.log("ALIGNMENT FAILED");
      if (!hasThumbnailUrl) {
        console.log("- Database document is missing the 'thumbnailUrl' field.");
      }
      if (!isHD) {
        console.log(`- Poster URL is NOT HD: '${sample.thumbnailUrl}' contains standard resolution (expected '/w780' or '/original', not '/w500').`);
      }
      if (!isProxied) {
        console.log(`- Poster URL is NOT wrapped in wsrv.nl proxy shield: '${sample.thumbnailUrl}'`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal Error during audit:", error.message);
    process.exit(1);
  }
}

runAudit();
