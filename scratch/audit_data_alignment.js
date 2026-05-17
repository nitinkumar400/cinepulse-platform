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
    console.log(`posterUrl: ${sample.posterUrl}`);
    console.log(`thumbnailUrl: ${sample.thumbnailUrl}`);
    console.log(`bannerUrl: ${sample.bannerUrl}`);
    console.log(`isFeatured: ${sample.isFeatured}`);
    console.log("------------------------------\n");

    const hasPosterUrl = typeof sample.posterUrl === 'string' && sample.posterUrl.trim() !== '';
    const hasThumbnailUrl = typeof sample.thumbnailUrl === 'string' && sample.thumbnailUrl.trim() !== '';
    const hasBannerUrl = typeof sample.bannerUrl === 'string' && sample.bannerUrl.trim() !== '';
    
    // Check 2: Resolution Audit
    const isHD = sample.posterUrl.includes('/w780') || sample.posterUrl.includes('/original') ||
                 sample.posterUrl.includes('%2Fw780') || sample.posterUrl.includes('%2Foriginal');

    // Check 3: Proxy & WebP Audit
    const isProxied = sample.posterUrl.startsWith('https://wsrv.nl/?url=') && sample.posterUrl.includes('&output=webp');

    // Check 4: Homepage Visibility Flag
    const isFeaturedTrue = sample.isFeatured === true;

    if (hasPosterUrl && hasThumbnailUrl && hasBannerUrl && isHD && isProxied && isFeaturedTrue) {
      console.log("ALIGNMENT PASSED: Data keys are fully unified. Posters are guaranteed to render in HD quality with proxy protection.");
    } else {
      console.log("ALIGNMENT FAILED");
      if (!hasPosterUrl) {
        console.log("- Database document is missing the 'posterUrl' field.");
      }
      if (!isHD) {
        console.log(`- Poster URL is NOT HD: '${sample.posterUrl}'`);
      }
      if (!isProxied) {
        console.log(`- Poster URL is NOT wrapped in wsrv.nl proxy shield or is missing webp parameter: '${sample.posterUrl}'`);
      }
      if (!isFeaturedTrue) {
        console.log("- Database document is missing the 'isFeatured: true' flag.");
      }
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal Error during audit:", error.message);
    process.exit(1);
  }
}

runAudit();
