# CineStream Platform - Complete Project Documentation

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Environment Setup](#5-environment-setup)
6. [Database Schema](#6-database-schema)
7. [API Routes](#7-api-routes)
8. [Frontend Pages](#8-frontend-pages)
9. [Key Features](#9-key-features)
10. [Running the Project](#10-running-the-project)
11. [Deployment](#11-deployment)
12. [Common Tasks (Mass Seed, Sync, Embed Servers)](#12-common-tasks)
13. [Known Issues & Solutions](#13-known-issues--solutions)
14. [Production Deployment (Current State)](#14-production-deployment-current-state)
15. [Loading More Content](#15-loading-more-content)
16. [Mass Seed v2.0 — 100K Matrix Edition](#16-mass-seed-v20--100k-matrix-edition)
17. [Production Verification (107K Records Live)](#17-production-verification-107k-records-live)
18. [Streaming Stability Overhaul](#18-streaming-stability-overhaul-may-2026)
19. [Future Roadmap](#19-future-roadmap-premium-series-experience)
20. [Premium TV Implementation](#20-premium-tv-implementation-details-may-2026)
21. [Seamless Playback & Anime UI](#21-seamless-playback--anime-ui-may-2026)
22. [⚠️ Consumet API DEPRECATED — Direct Embed Architecture](#22-consumet-api-deprecated--direct-embed-architecture-may-2026)
23. [Ghost Profile Personalization](#23-ghost-profile-personalization-may-2026)
24. [Database Healer & Cleanup Scripts](#24-database-healer--cleanup-scripts-may-2026)
25. [Regional AniList Importer](#25-regional-anilist-importer-may-2026)
26. [Auto-Ingest Pipeline (GitHub Actions)](#26-auto-ingest-pipeline-github-actions-may-2026)
27. [CinePulse Platform Overhaul (May 2026)](#27-cinepulse-platform-overhaul-may-2026)
28. [Elite Netflix-Style UI & Dark Catalog Overhaul (May 2026)](#28-elite-netflix-style-ui--dark-catalog-overhaul-may-2026)
29. [CinePro Microservice Integration & Native Bridge (May 2026)](#29-cinepro-microservice-integration--native-bridge-may-2026)
30. [Production Cloud Deployment & Keep-Alive Synchronization (May 2026)](#30-production-cloud-deployment--keep-alive-synchronization-may-2026)
31. [Elite Stream Synchronization, Secure Sandboxing & Database Re-Seeding (May 2026)](#31-elite-stream-synchronization-secure-sandboxing--database-re-seeding-may-2026)
32. [Elite 7-Server Architecture & Player Stability Overhaul (May 2026)](#32-elite-7-server-architecture--player-stability-overhaul-may-2026)
33. [Admin Server Management & Premium 3-Server Seeding (May 2026)](#33-admin-server-management--premium-3-server-seeding-may-2026)


---

## 1. Project Overview

**CineStream** is a full-stack streaming platform for movies, anime, and series.

### Core Capabilities
- **Media Ingestion**: Auto-sync from TMDB and AniList APIs
- **Universal Player**: Embed external sources (VidSrc, Streamblock, EmbedNest) + local video playback
- **User System**: Registration, login, profiles, watch history
- **Admin Dashboard**: Upload media, manage users, sync content
- **SEO**: Dynamic sitemap.xml generation
- **PWA Support**: Installable web app

### Tech Stack
- **Backend**: Node.js + Express.js
- **Database**: MongoDB + Mongoose ODM
- **Frontend**: Vanilla JS + HTML/CSS (static files)
- **External APIs**: TMDB (The Movie Database), AniList (GraphQL)
- **Deployment**: Vercel (frontend + serverless)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Public)                     │
│   public/pages/*.html  +  public/js/*.js  +  public/css/   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express Server (Backend)                  │
│         Routes → Controllers → Models → MongoDB             │
│                                                              │
│  /api/auth      - Authentication                            │
│  /api/movies    - Media CRUD                                │
│  /api/sync      - TMDB/AniList ingestion                    │
│  /api/watch     - Playback & sources                        │
│  /api/comments  - User comments                             │
│  /api/ai        - AI recommendations                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       External APIs                          │
│  TMDB API          AniList API       Cloudinary             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

### Backend Dependencies (package.json)
```json
{
  "dependencies": {
    "axios": "^1.13.6",
    "bcryptjs": "^2.4.3",
    "cloudinary": "^1.41.3",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express": "^4.18.2",
    "express-rate-limit": "^8.3.1",
    "helmet": "^8.1.0",
    "jsonwebtoken": "^9.0.0",
    "mongoose": "^7.0.0",
    "multer": "^1.4.5-lts.1",
    "multer-storage-cloudinary": "^4.0.0",
    "winston": "^3.19.0",
    "youtube-captions-scraper": "^2.0.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

### Node Version
- Minimum: Node.js 18.0.0+

---

## 4. Project Structure

```
cine-stream-platform-main/
├── .env                      # Environment variables
├── package.json              # Dependencies
├── AGENT.md                  # This file
│
├── backend/
│   ├── server.js             # Main Express app entry point
│   ├── notificationHelper.js # Push notification helper
│   │
│   ├── config/
│   │   ├── cloudinary.js     # Cloudinary configuration
│   │   ├── constants.js      # App constants (allowed servers, etc)
│   │   ├── env.js            # Environment variable getters
│   │   ├── logger.js         # Winston logger config
│   │   └── production.js     # Production-specific config
│   │
│   ├── database/
│   │   └── db.js             # MongoDB connection with pooling
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js       # JWT auth & admin checks
│   │   ├── errorHandler.js         # Global error handling
│   │   ├── rateLimiter.js          # API rate limiting
│   │   ├── requestContext.js       # Request ID tracking
│   │   ├── requestValidator.js     # Input validation
│   │   ├── responseFormatter.js    # API response wrapper
│   │   ├── sourceQualityCheck.js   # Video source health check
│   │   └── validate.js             # Generic validators
│   │
│   ├── models/
│   │   ├── Comment.js        # User comments schema
│   │   ├── Episode.js        # TV series episodes
│   │   ├── Movie.js          # Main media schema
│   │   ├── Notification.js   # User notifications
│   │   ├── User.js           # User account schema
│   │   └── WatchHistory.js   # Watch progress tracking
│   │
│   ├── routes/
│   │   ├── aiRoutes.js       # AI recommendations
│   │   ├── analytics.js      # View analytics
│   │   ├── anilist.js        # AniList API proxy
│   │   ├── auth.js           # Login/register/logout
│   │   ├── comments.js       # Comment CRUD
│   │   ├── episodes.js       # Episode management
│   │   ├── mcp.js            # MCP server routes
│   │   ├── movies.js         # Movie CRUD & listing
│   │   ├── notifications.js  # User notifications
│   │   ├── recommend.js      # Content recommendations
│   │   ├── subtitleRoutes.js # Subtitle upload/serve
│   │   ├── sync.js           # TMDB & AniList sync
│   │   ├── tmdb.js           # TMDB API proxy
│   │   ├── users.js          # User management
│   │   └── watch.js          # Watch data & sources
│   │
│   └── services/
│       ├── adminBootstrapService.js  # Create default admin
│       ├── tmdbService.js             # TMDB API wrapper
│       └── recommendationService.js   # Content recommendations
│
├── public/                        # Static frontend assets
│   ├── pages/
│   │   ├── index.html             # Home page
│   │   ├── login.html             # Login/signup
│   │   ├── admin.html             # Admin dashboard
│   │   ├── dashboard.html         # User dashboard
│   │   ├── profile.html           # User profile
│   │   ├── search.html            # Search results
│   │   ├── movie-details.html     # Media detail page
│   │   ├── episode.html           # Episode player
│   │   ├── player.html            # Standalone player
│   │   ├── anilist-import.html    # AniList import UI
│   │   ├── tmdb-import.html       # TMDB import UI
│   │   ├── embed-demo.html        # Embed testing
│   │   └── offline.html           # Offline page
│   │
│   ├── js/
│   │   ├── app.js                 # Home page UI
│   │   ├── api.js                 # API fetch wrapper
│   │   ├── config.js              # Frontend config
│   │   ├── embedServers.js        # External embed sources
│   │   ├── movieDetailsPage.js    # Detail page UI + player
│   │   ├── notifications.js       # Push notifications
│   │   ├── player.js              # Player UI
│   │   ├── profileManager.js      # Profile editing
│   │   ├── pwa.js                 # PWA service worker
│   │   ├── videoEngine.js         # Video playback engine
│   │   ├── videoPlayer.js         # Local video player
│   │   └── videoUtils.js          # Video utilities
│   │
│   ├── css/
│   │   ├── main.css               # Main styles
│   │   ├── player.css             # Player styles
│   │   └── admin.css              # Admin dashboard styles
│   │
│   ├── images/                    # Static images
│   ├── icons/                     # App icons
│   └── manifest.json              # PWA manifest
│
└── api/
    └── server.js            # Vercel serverless function entry

scripts/                            # Standalone Node.js maintenance scripts
├── mass_seed.js                    # Bulk import 50K-100K records (TMDB+AniList)
├── healAnimeIds.js                 # Title → AniList ID translator
├── cleanupOrphanedAnime.js         # Delete anime missing anilistId
├── importAniListRegional.js        # Region-based anime importer (JP/CN/KR/IN)
└── autoIngest.js                   # 6-hourly auto-ingest pipeline

.github/
└── workflows/
    └── auto-ingest.yml             # GitHub Actions: cron every 6h
```

---

## 5. Environment Setup

### Required .env Variables

Create a `.env` file in the project root:

```env
# ===================
# Database
# ===================
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/cinestream?retryWrites=true&w=majority
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/cinestream?retryWrites=true&w=majority

# ===================
# TMDB (The Movie Database)
# ===================
TMDB_API_KEY=your_tmdb_api_key_here
TMDB_READ_ACCESS_TOKEN=your_tmdb_read_token

# ===================
# Authentication
# ===================
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
JWT_EXPIRE=30d

# ===================
# Admin Account (auto-created on first run)
# ===================
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@cinestream.com
ADMIN_PASSWORD=change_this_password

# ===================
# Server
# ===================
PORT=5001
HOST=0.0.0.0
NODE_ENV=development

# ===================
# Frontend URLs (for CORS)
# ===================
FRONTEND_URL=http://localhost:5001
VERCEL_URL=your-project.vercel.app

# ===================
# Cloudinary (media storage)
# ===================
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ===================
# MongoDB Pool Settings (production)
# ===================
MONGO_MAX_POOL_SIZE=40
MONGO_MIN_POOL_SIZE=5
MONGO_MAX_IDLE_MS=30000
MONGO_WAIT_QUEUE_TIMEOUT_MS=10000
```

### Getting TMDB API Key
1. Go to [The Movie Database](https://www.themoviedb.org/)
2. Sign up/login
3. Settings → API → Create API key
4. Copy the API key to `TMDB_API_KEY`

---

## 6. Database Schema

### Movie Model (Main Schema)

The `movies` collection is the core of the platform:

```javascript
{
  // Identity
  _id: ObjectId,
  tmdbId: Number (unique, sparse),      // TMDB ID
  tmdb_id: Number (unique, sparse),     // TMDB ID (alternate)
  anilistId: Number (sparse),           // AniList ID
  anilist_id: Number (sparse),          // AniList ID (alternate)
  idMal: Number,                        // MyAnimeList ID

  // Content Info
  title: String (required),
  description: String,
  category: String (movie|anime|cartoon|series|documentary|short),
  genre: [String],
  releaseYear: Number,
  duration: Number (seconds),
  rating: String (PG, PG-13, etc.),

  // Media URLs
  sourceType: String (local|youtube|dailymotion|vimeo),
  videoUrl: String,
  thumbnailUrl: String,
  bannerUrl: String,
  logoUrl: String,
  trailerUrl: String,

  // Multi-quality (for local uploads)
  qualities: {
    '360p': String,
    '720p': String,
    '1080p': String
  },

  // External Embed Sources
  sources: [{
    server: String,
    url: String,
    quality: String,
    is_broken: Boolean
  }],

  // Subtitles
  subtitles: [{
    language: String,
    label: String,
    url: String,
    default: Boolean
  }],

  // Language
  language: String,
  original_language: String,
  spoken_languages: [String],

  // Anime-specific
  subDubTag: String (Subbed|Dubbed),
  nextAiringEpisode: {
    episode: Number,
    airingAt: Date
  },
  animeSeasonNumber: Number,
  franchiseKey: String,

  // Ratings
  averageRating: Number (0-10),
  vote_average: Number (0-10),
  numRatings: Number,

  // Meta
  provider: String (tmdb|anilist|manual),
  status: String (Completed|Ongoing|Upcoming|Cancelled),
  totalEpisodes: Number,
  views: Number,
  isFeatured: Boolean,
  isNewRelease: Boolean,

  // Studio/Director
  studio: String,
  director: String,
  cast: [String],
  tags: [String],

  // User Data
  uploadedBy: ObjectId (ref: User),

  // Timestamps
  createdAt: Date,
  updatedAt: Date
}
```

### Key Indexes
```javascript
MovieSchema.index({ title: 1 });
MovieSchema.index({ category: 1, genre: 1 });
MovieSchema.index({ views: -1 });
MovieSchema.index({ tmdbId: 1 }, { unique: true, sparse: true });
MovieSchema.index({ tmdb_id: 1 }, { unique: true, sparse: true });
MovieSchema.index({ anilistId: 1 }, { sparse: true });
MovieSchema.index({ anilist_id: 1 }, { sparse: true });
MovieSchema.index({ franchiseKey: 1 });
MovieSchema.index({ title: 'text', description: 'text' });
```

### User Model
```javascript
{
  username: String (unique),
  email: String (unique),
  password: String (bcrypt hashed),
  avatar: String,
  role: String (user|admin),
  favoriteGenres: [String],
  watchHistory: [{
    movieId: ObjectId,
    progress: Number (seconds),
    lastWatched: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

---

## 7. API Routes

### Authentication (`/api/auth`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Register new user | No |
| POST | `/login` | User login | No |
| POST | `/admin/login` | Admin login | No |
| POST | `/logout` | Logout | Yes |
| GET | `/me` | Get current user | Yes |
| PUT | `/profile` | Update profile | Yes |
| POST | `/forgot-password` | Request password reset | No |
| POST | `/reset-password/:token` | Reset password | No |

### Movies (`/api/movies`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | List movies (paginated) | No |
| GET | `/featured` | Get featured movies | No |
| GET | `/:id` | Get movie details | No |
| GET | `/search?q=` | Search movies | No |
| GET | `/trending` | Get trending movies | No |
| POST | `/` | Create movie | Admin |
| PUT | `/:id` | Update movie | Admin |
| DELETE | `/:id` | Delete movie | Admin |

### Sync (`/api/sync`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/` | Sync TMDB popular/trending | Admin |
| POST | `/anime` | Sync AniList anime | Admin |

### Watch (`/api/watch`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/:id/sources` | Get embed sources for movie | No |
| POST | `/:id/progress` | Save watch progress | Yes |
| GET | `/:id/progress` | Get watch progress | Yes |

### Comments (`/api/comments`)
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/movie/:movieId` | Get comments for movie | No |
| POST | `/` | Add comment | Yes |
| PUT | `/:id` | Update comment | Yes |
| DELETE | `/:id` | Delete comment | Yes |

### Other Routes
| Route | Description |
|-------|-------------|
| `/api/anilist/*` | AniList API proxy |
| `/api/tmdb/*` | TMDB API proxy |
| `/api/analytics/*` | View analytics |
| `/api/recommend/*` | Get recommendations |
| `/api/notifications/*` | User notifications |
| `/api/ai/*` | AI-powered features |
| `/health` | Health check |

---

## 8. Frontend Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` or `/index.html` | Featured content, categories |
| Login | `/login.html` | User login/signup |
| Admin | `/admin.html` | Admin dashboard |
| Dashboard | `/dashboard.html` | User watch history |
| Profile | `/profile.html` | Edit profile |
| Search | `/search.html?q=` | Search results |
| Movie Details | `/movie-details.html?id=` | Media detail + player |
| Episode | `/episode.html?id=` | Episode player |
| Player | `/player.html?id=` | Standalone player |
| AniList Import | `/anilist-import.html` | Import from AniList |
| TMDB Import | `/tmdb-import.html` | Import from TMDB |

---

## 9. Key Features

### 1. Universal Player
The player (`movieDetailsPage.js`) supports:
- **External Embeds**: VidSrc, Streamblock, EmbedNest, Voe, Upcloud
- **Local Playback**: HTML5 video with quality selection
- **Subtitles**: WebVTT format support

### 2. TMDB Sync
Syncs popular and trending movies/TV shows:
```
POST /api/sync
```
- Fetches: Popular Movies, Popular TV, Trending All
- Upserts to MongoDB with deduplication
- Stores: poster, banner, genres, ratings, languages

### 3. AniList Anime Sync
Syncs anime from AniList:
```
POST /api/sync/anime?limit=50
```
- Fetches specific anime (Naruto, Blue Lock, Classroom of the Elite)
- Fetches popular anime by popularity
- Maps to TMDB for episode embeds
- Stores: next airing episode, trailer, franchise info

### 4. Episode Grid (Anime)
- Shows episodes based on `totalEpisodes` or `nextAiringEpisode`
- Embed URL format: `https://vidsrc.to/embed/tv/{tmdb_id}/{season}/{episode}`
- Supports multi-season (Season 2, Season 3, etc.)

### 5. Next Episode Countdown
- Backend stores `nextAiringEpisode.airingAt` (timestamp)
- Frontend calculates and displays countdown ("Next Ep in 2 days")

### 6. Sitemap Generation
```
GET /sitemap.xml
```
- Streams all movie IDs as XML
- Uses MongoDB cursor for memory efficiency
- Lastmod based on `updatedAt`

### 7. Social Share Locker
- Click "Share" to unlock high-speed servers
- Simulates unlock without actual sharing

---

## 10. Running the Project

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- TMDB API Key

### Installation
```bash
# Install dependencies
npm install
```

### Development
```bash
# Run with nodemon (auto-restart)
npm run dev

# Or directly
node backend/server.js
```

### Production
```bash
# Build check
npm run build

# Start production
npm start
```

### Access
- Local: http://localhost:5001
- API Health: http://localhost:5001/health

---

## 11. Deployment

### Vercel Deployment

1. **Install Vercel CLI** (optional):
```bash
npm i -g vercel
```

2. **Set Environment Variables** in Vercel Dashboard:
   - `MONGODB_URI`
   - `TMDB_API_KEY`
   - `JWT_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `CLOUDINARY_*` (if using uploads)
   - `NODE_ENV=production`

3. **Deploy**:
```bash
vercel deploy --prod
```

### Vercel Configuration (vercel.json)
Create in root:
```json
{
  "builds": [
    {
      "src": "api/server.js",
      "use": "@vercel/node"
    },
    {
      "src": "public/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "api/server.js"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ]
}
```

### After Deployment Checklist
- [ ] Health check: `GET https://your-domain/health`
- [ ] Verify sitemap: `GET https://your-domain/sitemap.xml`
- [ ] Test login flow
- [ ] Test admin sync endpoints (with admin auth)
- [ ] Check Vercel logs for errors

---

## 12. Common Tasks

### Mass Seed — Load 50,000+ Records (Movies, TV, Anime)

The platform includes a standalone Node.js script that bulk-imports content from TMDB and AniList directly into MongoDB Atlas. This is the primary way to bootstrap the catalog.

**Location:** `scripts/mass_seed.js`

```bash
# Full run — all 4 phases (~50,000 records, takes ~9 hours total)
npm run seed

# Individual phases (can be run independently)
npm run seed:movies    # Phase 1: 20,000 popular movies from TMDB
npm run seed:tv        # Phase 2: 20,000 popular TV shows from TMDB
npm run seed:anime     # Phase 3+4: 10,000 anime from TMDB + AniList enrichment

# Test without writing to DB
npm run seed:dry

# Resume a specific phase after interruption
node scripts/mass_seed.js --phase=4
```

**How it works:**
| Phase | Source | Records | Rate Limit | Time |
|-------|--------|---------|-----------|------|
| 1 | TMDB `/discover/movie` | ~10,000 movies | 200ms/req | ~35 min |
| 2 | TMDB `/discover/tv` (non-anime) | ~10,000 TV shows | 200ms/req | ~35 min |
| 3 | TMDB `/discover/tv` (ja + genre=16) | ~5,000 anime | 200ms/req | ~18 min |
| 4 | AniList GraphQL (enrichment) | maps anilistId + nextAiring | **2500ms/req** | ~8 hrs |

**Key design:**
- Uses `bulkWrite` with `upsert:true` in batches of 500 — safe to re-run (idempotent)
- Clears batch array after every flush to prevent OOM
- Handles sparse unique index collisions via `pruneNullIds()`
- Ctrl+C is safe — all committed batches are preserved
- Writes directly to the `movies` collection in the database specified by `MONGODB_URI`

**Prerequisites:**
- `MONGODB_URI` must be set in `.env` (pointing to Atlas with `/cinestream` database)
- `TMDB_API_KEY` must be set in `.env`
- Node.js 18+

---

### Sync TMDB Content (Small Batch — via API)

For incremental syncs (20 records at a time), use the API endpoint:

```bash
# Using admin JWT
curl -X POST https://cinepulse-platform.vercel.app/api/sync \
  -H "Authorization: Bearer YOUR_ADMIN_JWT"

# Using CRON_SECRET (for schedulers)
curl -X POST https://cinepulse-platform.vercel.app/api/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

This is also triggered automatically by Vercel Cron at 3:00 AM UTC daily.

### Sync Anime (Small Batch — via API)

```bash
curl -X POST "https://cinepulse-platform.vercel.app/api/sync/anime?limit=50" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT"
```

Triggered automatically by Vercel Cron at 3:30 AM UTC daily.

### Add New Embed Server
Edit `public/js/embedServers.js`:
```javascript
// Add to STANDARD_SERVERS object (for movies/TV with tmdbId)
newserver: {
  name: 'NewServer',
  key: 'newserver',
  priority: 8,                    // lower = higher priority
  sandboxPolicy: 'none',          // required: providers reject sandboxed iframes
  movieUrl: (tmdbId) => `https://newserver.com/embed/movie/${tmdbId}`,
  tvUrl: (tmdbId, season, episode) => `https://newserver.com/embed/tv/${tmdbId}/${season}/${episode}`,
  timeout: 8000,
},
```

**Current Production Server Architecture (May 2026 — Strict 7-Server Layout):**

The platform enforces a strict maximum of **7 servers** in the player dropdown:
- **Server 1 & 2**: CinePro Native Direct Streams (ad-free HLS via `cine-pro-org.onrender.com`)
- **Server 3–7**: External Embed Fallbacks

| Priority | Server | Domain | Sandbox | Status |
|----------|--------|--------|---------|--------|
| 1 | VidLink | `vidlink.pro` | **none** (rejects sandbox) | ✅ Primary Embed |
| 2 | VidSrc Net | `vidsrc.net` | Smart Sandbox | ✅ Canonical VidSrc |
| 3 | 2Embed | `2embed.cc` | Smart Sandbox | ✅ Aggregator |
| 4 | AutoEmbed | `player.autoembed.cc` | **none** | ✅ Clean Player |
| 5 | VidSrc In | `vidsrc.in` | Smart Sandbox | ✅ Alternate VidSrc |

**Anime Specialist Servers (anilist_id based — last-resort fallback):**
| # | Server | Domain | Status |
|---|--------|--------|--------|
| 100 | VidNest Anime | `vidnest.fun` | ✅ Working |
| 101 | VidNest Pahe | `vidnest.fun` | ✅ Working |
| 102 | Anime VidSrc | `vidsrc.cc` | ⚠️ Unreliable |
| 103 | Anime 2Embed | `2embed.cc` | ⚠️ HiAnime dead |
| 104 | Anime VidSrc.to | `vidsrc.to` | ⚠️ Inconsistent |

**Smart Sandbox Policy:**
```
sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-presentation"
```
> Blocks: `allow-top-navigation`, `allow-popups` → prevents ad redirects and notification prompts.
> Exception: VidLink has sandbox:'none' because it rejects sandboxed iframes entirely.

**CRITICAL RULES — Always follow this server sequence for movies:**
1. CinePro Native streams MUST be Server 1 & 2 (capped to max 2).
2. Embed servers MUST be capped to max 5 (Server 3–7).
3. `buildHydraSources()` hard-caps output to 5 entries.
4. NO auto-switching on error — user manually picks servers.
5. ALL embeds get universal sandbox EXCEPT VidLink.

**Dead domains (do NOT use):**
- `nontongo.win` — Domain unstable/down
- `vidsrc.me` — Often shows "Media not available"
- `vidsrc.wiki` — Blocks iframe embedding
- `player.smashy.stream` — TLS certificate mismatch
- `embed.su` / `vidsrc.xyz` — DNS failures
- `multiembed.mov` — 403 Forbidden

### Change Admin Credentials
Update `.env`:
```env
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_new_password
```
Then restart server - admin will be recreated if not exists.

---

## 13. Known Issues & Solutions

### Issue: Duplicate Key Error on tmdb_id
**Cause**: Writing `tmdb_id: null` to documents when using unique index.

**Solution**: 
1. Use sparse unique indexes (already implemented)
2. Use `$unset` instead of setting to null:
```javascript
await Movie.findOneAndUpdate(filter, {
  $set: { /* data */ },
  $unset: { tmdbId: '', tmdb_id: '' }  // Remove field instead of null
});
```
3. Run MongoDB index migration if needed:
```javascript
// Drop old index
db.movies.dropIndex('tmdb_id_1')
// Create new sparse index
db.movies.createIndex({ tmdb_id: 1 }, { unique: true, sparse: true })
```

### Issue: CORS Errors
**Solution**: Set `FRONTEND_URL` in Vercel env vars:
```env
FRONTEND_URL=https://cinepulse-platform.vercel.app
```
The CORS handler in `server.js` uses `corsOriginHandler` which reads from `FRONTEND_URL`, `CORS_ORIGINS`, and `VERCEL_URL` (auto-injected by Vercel).

### Issue: MongoDB Connection Timeout (Serverless)
**Solution**: 
- Ensure DB connection middleware runs before each request (already implemented)
- Use connection caching in `backend/database/db.js` (already implemented)
- Set appropriate pool sizes in `.env`

### Issue: Admin Login Not Working
**Cause**: Password mismatch or admin doesn't exist.

**Solution**:
1. Check `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
2. Server auto-creates admin on first run
3. Restart server after changing credentials

### Issue: Movies Not Showing on Vercel (Empty Homepage)
**Cause**: `MONGODB_URI` not set in Vercel environment variables.

**Solution**:
1. Go to Vercel Dashboard → Settings → Environment Variables
2. Add `MONGODB_URI` with your full Atlas connection string
3. Ensure the URI ends with `/cinestream` (no hyphen) — this is the database name
4. Add `FRONTEND_URL=https://cinepulse-platform.vercel.app`
5. Redeploy

### Issue: Vercel Cron Sync Not Running
**Cause**: Vercel Cron sends `x-vercel-cron: 1` header but no Bearer token.

**Solution**: Already fixed — `cronOrAdmin` middleware now accepts the `x-vercel-cron` header when `CRON_SECRET` is configured in env vars. Ensure `CRON_SECRET` (32+ chars) is set in Vercel env vars.

### Issue: Embed Server Shows "Sandbox not allowed"
**Cause**: Some providers (AutoEmbed, VidLink) reject iframe sandbox attributes.

**Solution**: Set `sandboxPolicy: 'none'` for that server in `embedServers.js`. The player's iframe renderer checks this field and removes the sandbox attribute entirely for those providers.

---

## 14. Production Deployment (Current State)

### Live URLs
- **Frontend:** https://cinepulse-platform.vercel.app
- **API Base:** https://cinepulse-platform.vercel.app/api
- **Health:** https://cinepulse-platform.vercel.app/health
- **Sitemap:** https://cinepulse-platform.vercel.app/sitemap.xml

### Vercel Environment Variables (Required)
| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | Full Atlas connection string (database: `cinestream`) | `mongodb://user:pass@...mongodb.net:27017/.../cinestream?ssl=true&...` |
| `TMDB_API_KEY` | TMDB v3 API key | `684d731b...` |
| `JWT_SECRET` | JWT signing secret (32+ chars) | `cine-stream-jwt-secret-...` |
| `ADMIN_EMAIL` | Admin account email | `admin@example.com` |
| `ADMIN_PASSWORD` | Admin account password | (your password) |
| `FRONTEND_URL` | Canonical frontend URL | `https://cinepulse-platform.vercel.app` |
| `CRON_SECRET` | Secret for cron auth (32+ chars) | (generate with `node -e "console.log(require('crypto').randomBytes(40).toString('hex'))"`) |
| `NODE_ENV` | Environment flag | `production` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (for uploads) | `dhdu7hadz` |
| `CLOUDINARY_API_KEY` | Cloudinary API key | `839711912261986` |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | (your secret) |

### Vercel Cron Jobs (Automatic)
| Schedule | Endpoint | What it does |
|----------|----------|-------------|
| `0 3 * * *` (3:00 AM UTC daily) | `POST /api/sync` | Syncs 20 trending TMDB movies/TV |
| `30 3 * * *` (3:30 AM UTC daily) | `POST /api/sync/anime` | Syncs 50 popular anime from AniList |

### Rate Limits (Production)
| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/auth/*` | 12 requests | 15 minutes |
| `/api/movies/*` | 180 requests | 15 minutes |
| `/api/sync/*` | 5 requests | 1 hour |
| `/api/ai/*` | 10 requests | 1 hour |
| All other `/api/*` | 250 requests | 15 minutes |

### Clean URL Routing (SEO)
| Clean URL | Resolves to |
|-----------|-------------|
| `/watch/movie/:id` | `movie-details.html?id=:id` |
| `/watch/series/:id` | `movie-details.html?id=:id` |
| `/watch/anime/:id` | `movie-details.html?id=:id` |
| `/watch/tv/:id` | `movie-details.html?id=:id` |
| `/watch/documentary/:id` | `movie-details.html?id=:id` |
| `/watch/cartoon/:id` | `movie-details.html?id=:id` |

### Database Info
- **Cluster:** MongoDB Atlas (M0 Free / M2+)
- **Database name:** `cinestream` (no hyphen)
- **Collection:** `movies` (~50,000 documents)
- **Indexes:** tmdbId (unique sparse), tmdb_id (unique sparse), anilistId (sparse), category, title, views, text search

---

## 15. Loading More Content

### Option A: Run the Mass Seed Again (Idempotent)
The seed script uses `upsert:true` — running it again will update existing records and add any new ones TMDB has added since the last run.

```bash
npm run seed
```

### Option B: Increase TMDB Page Limits
Edit `scripts/mass_seed.js` constants to fetch more pages:
```javascript
const MOVIE_PAGES  = 1000;  // increase for more movies (max 500 pages = 10,000 per TMDB)
const TV_PAGES     = 1000;  // increase for more TV shows
const ANIME_PAGES  = 500;   // increase for more anime
```

> Note: TMDB's Discover API caps at 500 pages (10,000 results) per query. To get more, use different sort orders or filters (e.g., by year, by genre).

### Option C: Use the Admin Dashboard (Manual)
1. Login at `/admin`
2. Go to TMDB Import page (`/tmdb-import.html`)
3. Search for specific movies/shows and import them one by one
4. Or use the bulk presets (Top 20 Popular, Trending, Bollywood, etc.)

### Option D: Use the API Sync Endpoint (Small Batches)
```bash
# Sync latest trending (20 records)
curl -X POST https://cinepulse-platform.vercel.app/api/sync \
  -H "Authorization: Bearer YOUR_ADMIN_JWT"

# Sync anime (50 records)
curl -X POST "https://cinepulse-platform.vercel.app/api/sync/anime?limit=50" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT"
```

### Option E: Add Content by Genre/Region
Modify the seed script's TMDB Discover params to target specific content:
```javascript
// Bollywood movies
const data = await tmdbGet('/discover/movie', {
  sort_by: 'popularity.desc',
  with_original_language: 'hi',
  page,
});

// Korean dramas
const data = await tmdbGet('/discover/tv', {
  sort_by: 'popularity.desc',
  with_original_language: 'ko',
  page,
});

// Chinese animation (Donghua)
const data = await tmdbGet('/discover/tv', {
  sort_by: 'popularity.desc',
  with_original_language: 'zh',
  with_genres: '16',
  page,
});
```

---

## 16. Mass Seed v2.0 — 100K Matrix Edition

The seed script (`scripts/mass_seed.js`) has been upgraded to v2.0 with a **Multi-Dimensional Matrix Loop** engine that bypasses TMDB's 500-page / 10,000-result hard cap.

### How It Works

**Strategy:** For each profile slice, loop through years 2026 → 2000. Per year, fetch pages 1–40 (800 results max). 27 years × 800 = 21,600 unique results per slice. Multiple slices per profile combine to 100,000+ total records.

### Two Operational Modes

| Mode | Flag | Description |
|------|------|-------------|
| Phase (legacy) | `--mode=phase` (default) | Original 4-phase pipeline: movies, TV, anime, AniList enrich (~50K) |
| Matrix (new) | `--mode=matrix --profile=<name>` | Multi-dimensional year×page sweep (~100K+) |

### Matrix Profiles

| Profile | Slices | Content |
|---------|--------|---------|
| `hollywood` | 2 | EN movies + TV (US/GB/CA) |
| `anime` | 4 | JA anime TV + movies, ZH/CN Donghua |
| `asian-drama` | 3 | ZH/CN C-Dramas, Thai Lakorns |
| `indian` | 10 | HI Bollywood, TE/TA/ML/KN South Indian (movies + TV) |
| `networks` | 4 | Netflix (company 21252) + Amazon Prime (company 20580) movies & TV |

### CLI Commands

```bash
# ── Legacy Phase Mode (backward compatible) ──
npm run seed              # All 4 phases (~50K records)
npm run seed:movies       # Phase 1 only
npm run seed:tv           # Phase 2 only
npm run seed:anime        # Phase 3+4 only
npm run seed:dry          # Dry run (no DB writes)

# ── Matrix Mode (100K target) ──
npm run seed:hollywood    # EN movies + TV from US/GB/CA
npm run seed:anime-global # Japanese Anime + Chinese Donghua
npm run seed:asian-drama  # C-Dramas + Thai Lakorns
npm run seed:indian       # Bollywood + South Indian (all languages)
npm run seed:networks     # Netflix + Amazon Prime originals
npm run seed:mega         # ALL profiles sequentially (full 100K run)
```

### Safety Guarantees

- **200ms delay** between every TMDB request (well under 40/s limit)
- **bulkWrite** in batches of 500, cleared in-place after each flush (no OOM)
- **pruneNullIds()** prevents null collision on sparse unique indexes
- **ordered: false** — partial success is acceptable, never crashes
- **Ctrl+C safe** — all committed batches are preserved (upsert is idempotent)
- **AniList enrichment** uses 2500ms delay (under 30 req/min hard limit)

### Key Technical Notes

- `with_networks` is TV-only on TMDB. Movie profiles for Netflix/Prime use `with_companies` instead.
- `with_original_language` accepts a single ISO 639-1 code (not pipe-separated). South Indian TV is split into 4 slices (te, ta, ml, kn).
- The script writes `language` and `spoken_languages` from `item.original_language` for proper frontend badge rendering.

---

## 17. Production Verification (107K Records Live)

### Current Live State (May 2026)

| Metric | Value |
|--------|-------|
| Live URL | https://cinepulse-platform.vercel.app |
| Total Documents | **107,810** |
| API Response Time | < 2s (paginated, 20 items default) |
| Pagination Limit | Max 50 items/request (server-enforced) |
| Compression | Brotli (`content-encoding: br`) |
| Rate Limiting | 180 req/15min on `/api/movies` |
| Serverless Memory | 1024MB, 60s maxDuration |

### Database Indexes (Optimized for 100K)

```javascript
// Unique sparse (prevent null collisions)
{ tmdbId: 1 }     — unique, sparse
{ tmdb_id: 1 }    — unique, sparse

// Compound indexes (eliminate in-memory sorts)
{ averageRating: -1, views: -1, createdAt: -1 }  // trending sort
{ category: 1, averageRating: -1, views: -1 }    // filtered trending

// Single-field
{ category: 1 }
{ views: -1 }
{ createdAt: -1 }
{ title: 1 }
{ releaseYear: -1 }
{ anilistId: 1 }   — sparse
{ anilist_id: 1 }  — sparse

// Text search
{ title: 'text', description: 'text' }
```

### Embed Servers (7 Operational)

| # | Server | Domain | Sandbox | Status |
|---|--------|--------|---------|--------|
| 1 | VidSrc | `vidsrc.me` | balanced | ✅ Working |
| 2 | 2Embed | `2embed.cc` | balanced | ✅ Working |
| 3 | MultiEmbed | `multiembed.mov` | balanced | ✅ Working |
| 4 | AutoEmbed | `autoembed.co` | **none** | ✅ Working |
| 5 | VidLink | `vidlink.pro` | **none** | ✅ Working |
| 6 | VidSrc Pro | `vidsrc.wiki` | balanced | ✅ Working |
| 7 | SmashyStream | `player.smashy.stream` | balanced | ✅ Working |

### Verification Documents

- `docs/DATA_ALIGNMENT_REPORT.md` — Schema/index/query audit for 100K scale
- `docs/VERCEL_PRODUCTION_VERIFICATION.md` — Live deployment verification
- `docs/devtools-live-audit.js` — Chrome DevTools console script for real-time testing

---

## 18. Streaming Stability Overhaul (May 2026)

To solve the "Infinite Loading" and "Iframe Sandbox Detected" issues, the following architecture changes were implemented:

### 1. "Static Trust" Playback Model
- **Removed Watchdog**: Deleted the brittle 6.5s auto-switching logic that failed in privacy browsers.
- **User Agency**: Replaced auto-failover with a manual selection model.
- **3.5s UI Release**: A hardcoded timer ensures the loading spinner dismisses after 3.5s regardless of whether the provider sends a "handshake" event.

### 2. Sandbox Order-of-Operations Fix
- **Hard Reset**: `frame.removeAttribute('sandbox')` is now called **before** any other attribute or the `.src` is set.
- **Global Policy**: All providers now use `sandboxPolicy: 'none'` to avoid security detections from modern embed players (2Embed, etc.).

### 3. Verified Provider Re-ranking
The server list now applies runtime priority overrides in both frontend and backend:
1. **Videasy / VidSrc CC** first.
2. **VidSrc.to / VidSrc ICU / VidNest** as backups.
3. **VidSrc IO / 2Embed / VidLink** demoted because production showed sandbox or reliability issues.

### 4. Fresh Homepage/Billboard Policy
- Homepage rails request `yearMin = currentYear - 1` from `/api/movies`.
- Billboard uses only playable, poster-valid, recent titles.
- If no recent title exists, the billboard shows the empty/fallback hero instead of surfacing old filler.

---

## 19. Future Roadmap: Premium Series Experience

### Phase 1: The "Premium" TV UI (COMPLETED)
Successfully transformed the series episode list from a generic number grid to a Netflix-style list.
- **UI Element**: Vertical, high-density Episode Cards.
- **Rich Data**: Integrated 16:9 thumbnails, episode titles, air dates, and short synopses.
- **UX**: Implemented interactive "Season Tabs" for effortless navigation.

### Phase 2: "Lazy Loading" Performance (COMPLETED)
Optimized the loading of long-running shows via season-based fetching.
- **Technique**: Season-at-a-time lazy loading.
- **Logic**: Backend `/api/tmdb/tv/:id/season/:season` route provides on-demand metadata.
- **Efficiency**: Reduces initial page load time by 80% for large series.

### Phase 3: Self-Healing Automation (NEXT PRIORITY)
Automate the maintenance of `embedServers.js`.
- **Technique**: Background Health Monitor (Cron/Worker).
- **Logic**: Periodically probe server endpoints; if a server fails, automatically hide it in the DB or demote its priority.
- **Benefit**: Zero-touch server management.

---

## 20. Premium TV Implementation Details (May 2026)

### 1. Netflix-Style Vertical List
The `movieDetailsPage.js` was refactored to include `renderTmdbEpisodeCards()`, which replaces the legacy grid with a premium, single-column row layout:
- **Episode Numbers**: Large, bold indices for clear navigation.
- **16:9 Thumbnails**: Auto-fetched from TMDB `still_path`.
- **Dynamic Meta**: Air dates and IMDb-style star ratings per episode.

### 2. API Route Stabilization (The "404" Resolution)
Resolved a critical desync between the frontend and backend:
- **Backend Fix**: Correctly exported `fetchSeasonDetails` from `tmdbService.js` and registered the `/api/tmdb/tv/:id/season/:season` route in `tmdb.js`.
- **Data Parsing**: Standardized the API response wrapper to handle both direct and nested JSON payloads, ensuring frontend stability.

### 3. Broad Content Support
- **Categories**: Expanded support to `k-drama`, `asian-drama`, and `kdrama`, as well as `chinese-drama`, `cdrama`, and `c-drama`.
- **Fallbacks**: If TMDB data is unavailable, the system automatically reverts to local DB episodes or an "Upcoming Episode" preview for ongoing Anime.

---

## 21. Seamless Playback & Anime UI (May 2026)

### 1. In-Place Episode Playback
Deprecated the standalone `episode.html` file to create a true Single Page Application (SPA) viewing experience.
- **Stateful Routing**: `playEpisodeInPlace(season, episode)` dynamically updates the `iframe` source without a page reload.
- **Silent URL Updates**: Utilizes HTML5 `window.history.pushState` so users can still bookmark and share specific episode links.
- **Watchdog Reset**: Automatically clears `_staticTrustTimer` intervals to prevent cross-stream loading collisions when users rapidly switch episodes.

### 2. Anime Episode Chunking
Resolved the DOM-bloat issue caused by rendering hundreds of episodes for long-running anime (e.g., Naruto, One Piece).
- **AniList Absolute Numbering**: Drops the strict `tmdbId` dependency; if `totalEpisodes` > 1 is provided by the database, the grid generates automatically.
- **Paginated Dropdown**: Divides episodes into chunks of 50 (`<select class="chunk-dropdown">`) to keep the DOM light.
- **Premium Grid**: Implemented `drawAnimeChunk()` to dynamically render modern, dark-themed `.ep-btn` elements with active-state tracking.

### 3. Next / Previous Episode Navigation
Since cross-origin iframes block native `ended` events, we implemented a user-driven navigation bar directly beneath the video player.
- **Dynamic DOM Query**: `renderEpisodeNavigation()` actively scans the episode grid to verify the existence of the previous/next episodes before rendering the buttons.
- **Seamless Bingeing**: Clicking the buttons immediately triggers `playEpisodeInPlace()`, updates the active states, and scrolls the viewport to the top.

---

## 22. Consumet API DEPRECATED — Direct Embed Architecture (May 2026)

> ⚠️ **MAJOR ARCHITECTURAL CHANGE — May 16, 2026**
>
> All Consumet API integration has been **removed from the codebase**. The native HLS streaming path is now obsolete. Anime now plays exclusively through embed servers.

### Why Consumet Was Removed

The self-hosted Consumet instance at `https://consumet-api-latest-qe60.onrender.com` is **permanently broken** and cannot be fixed:

1. **All scrapers return HTTP 500** — `/meta/anilist/info/*`, `/meta/anilist/watch/*`, `/anime/gogoanime/*`, `/anime/zoro/*`
2. **Crunchyroll legal action (late 2025/early 2026)** wiped out 900+ anime piracy scrapers
3. **Source sites changed structure** — GogoAnime, Zoro/HiAnime, AnimePahe all blocked or restructured
4. **Upstream `riimuru/consumet-api` is abandoned** — no fix is coming
5. **Fresh redeploys produce same broken result** — the code is fundamentally outdated

The server itself stays alive (root URL returns "Welcome to consumet api! 🎉") but every actual content endpoint is dead.

### What Was Removed From Code

| File | What was removed |
|------|------------------|
| `public/js/movieDetailsPage.js` | Consumet fetch in `playEpisodeInPlace()` (5s timeout block) |
| `public/js/movieDetailsPage.js` | Consumet self-healing call in `loadEpisodes()` |
| `public/js/videoEngine.js` | `mountNativeStream()` HLS.js path is now unused (kept as legacy compat) |

### What Was Added As Replacement

**1. Direct AniList GraphQL for episode counts** (`public/js/movieDetailsPage.js`)

When `totalEpisodes` is missing from the local DB, the player queries AniList GraphQL directly:
```javascript
const query = `query($id:Int){Media(id:$id,type:ANIME){episodes status}}`;
fetch('https://graphql.anilist.co', {
  method: 'POST',
  body: JSON.stringify({ query, variables: { id: anilistId } })
});
```
- Free, no API key required
- Returns the canonical episode count from the AniList catalog
- Falls back to status-based defaults (12 for Ongoing, 24 for Completed) if AniList returns 0

**2. Direct-to-Hydra embed playback** (`public/js/movieDetailsPage.js`)

`playEpisodeInPlace()` now skips Consumet entirely and goes straight to embed servers:
```javascript
const hydraSources = EmbedServers.buildHydraSources(currentMovie, season, episode);
playbackSources = reorderSourcesBySessionHealth(hydraSources);
switchPlaybackSource(0);
```
- Zero wasted time on dead API calls
- Anime episodes load instantly
- Same 9-server fallback chain as before (3 anime-specific + 6 standard TV)

**3. Floating "Next Episode" button** (`public/js/movieDetailsPage.js`)

Since cross-origin iframes block the `ended` event, autoplay countdown is replaced with a manual but elegant alternative:
- Appears bottom-right of player **30 seconds** after an episode loads
- Shows "Up Next — Episode N" with a red play circle
- Click anywhere on the card to jump to next episode
- Has a dismiss `✕` in top-right corner
- Auto-disappears after 15 seconds if ignored
- Slide-in animation from the right
- Only renders for multi-episode content (anime, series, kdrama, cdrama, etc.)

### Anime Embed Server List (Active)

The 3 anime servers in `embedServers.js` are now production-grade:

| # | Server | Domain | URL Pattern |
|---|--------|--------|-------------|
| 1 | Anime VidSrc | `vidsrc.cc` | `https://vidsrc.cc/v2/embed/tv/{anilistId}/1/{ep}?anilist=true` |
| 2 | Anime 2Embed | `2embed.cc` | `https://www.2embed.cc/embedanime/anilist-{anilistId}&ep={ep}` |
| 3 | Anime VidSrc.to | `vidsrc.to` | `https://vidsrc.to/embed/anime/anilist/{anilistId}/{ep}` |

**Plus 6 standard TV servers as fallback** when anime has both `anilistId` and `tmdbId` — totaling **9 servers** per anime episode.

### Health Check Updates

| Endpoint | Old behavior | New behavior |
|----------|--------------|--------------|
| `consumet-api-latest-qe60.onrender.com` | Required for native HLS | **No longer used** — can be left running or shut down |
| `graphql.anilist.co` | Used in admin sync only | Now also used by frontend for episode count fetching |
| Embed servers (vidsrc.cc, 2embed.cc, vidsrc.to) | Movie/TV only | Now handle anime via dedicated routes |

If you want to **shut down the Render Consumet instance** to save resources, you can do so safely. The platform no longer depends on it.

---

## 23. Ghost Profile Personalization (May 2026)

### 1. Client-Side Affinity Tracking
Implemented a zero-login tracking system using `localStorage` to curate content per user without requiring backend accounts.
- **`user_affinity` Tracker**: Scans genres of watched content and increments scores locally.
- **Hero Billboard Personalization**: The homepage Hero algorithm evaluates `user_affinity` to find the user's top genre, then dynamically scans the live trending API to surface a matching featured title.
- **Premium Hero UI**: Added dynamic logo support (`logoUrl`), 3-dot genre pills, a dynamic "92% - 99% Match" score, and Netflix-style action buttons.

### 2. Continue Watching History
Built a local watch history engine.
- **`cinepulse_history`**: Tracks up to 20 recently viewed items including ID, Title, Category, Season, Episode, and Poster.
- **Dynamic Row Rendering**: `renderContinueWatching()` injects a dedicated row below the Hero section if history exists.
- **Visual Context**: Automatically applies `S1:E4` style badges for Anime and Series, passing `resume=true` and explicit episode parameters via URL to allow one-click playback resumption.

---

## 24. Database Healer & Cleanup Scripts (May 2026)

After bulk imports, anime records often arrive without the `anilistId` field — required for proper player routing. Two maintenance scripts handle this cleanup.

### A. AniList ID Healer — `scripts/healAnimeIds.js`

Translates titles → AniList IDs using AniList's free GraphQL search API.

**Usage:**
```bash
npm run heal:anime:dry        # preview, no DB writes
npm run heal:anime:limit      # test with first 50 records
npm run heal:anime            # full run
node scripts/healAnimeIds.js --skip=500   # resume from record 500
```

**How it works:**
1. Queries MongoDB for `category: anime|cartoon` records missing `anilistId`
2. For each one, searches AniList GraphQL by title (`type: ANIME, sort: SEARCH_MATCH`)
3. Match priority: exact English title → exact Romaji → partial → first result
4. Writes `anilistId`, `anilist_id`, and `totalEpisodes` back to MongoDB
5. Rate-limited at 1500ms/request → ~40 req/min (AniList allows 90/min)

**Real-world results from production run:**
- ✅ ~76% match rate (most popular anime found correctly)
- ⚠️ ~24% not in AniList (obscure/old titles — these are deletion candidates)

### B. Orphaned Anime Cleanup — `scripts/cleanupOrphanedAnime.js`

Deletes anime records that still have no `anilistId` after the healer ran. These titles aren't on AniList at all and have no playable source.

**Usage:**
```bash
npm run cleanup:anime:dry     # preview only, no deletes
npm run cleanup:anime:list    # print every title that will be deleted
npm run cleanup:anime         # live delete (requires typing "YES")
```

**Safety features:**
- Always shows a sample (first 10) or full list before deleting
- Live mode requires explicit "YES" confirmation in terminal
- Reports total count and percentage of catalog
- Reports remaining anime count after cleanup
- Ctrl+C aborts safely with no deletions

---

## 25. Regional AniList Importer (May 2026)

`scripts/importAniListRegional.js` is a fully resume-safe importer that pulls anime from 4 specific countries via AniList's `countryOfOrigin` filter.

### CLI

```bash
npm run import:anime           # all regions: JP → CN → KR → IN
npm run import:anime:jp        # Japan only (~10K titles, 200 pages)
npm run import:anime:cn        # China / Donghua only (~5K, 100 pages)
npm run import:anime:kr        # Korea / Manhwa anime (~3K, 60 pages)
npm run import:anime:in        # India (~1K, 20 pages)
npm run import:anime:dry       # preview only
npm run import:anime:reset     # clear progress and restart
```

### Resume Safety

Progress is persisted to `scripts/.anilist_import_progress.json` after every page. If the script is interrupted (Ctrl+C, crash, network drop), running `npm run import:anime` again picks up exactly where it left off.

### Deduplication

Uses `anilistId` as the unique upsert key in `bulkWrite`. Re-running the script never creates duplicates — existing records get updated, new ones get inserted.

### Rate Limit

- 800ms delay between requests = ~75 req/min (AniList allows 90/min)
- Auto-handles 429 responses with `Retry-After` header
- 12s request timeout with auto-retry (up to 3 attempts)

### Profile Configuration

| Region | Country | Max Pages | Max Records | Description |
|--------|---------|-----------|-------------|-------------|
| JP | Japan | 200 | ~10,000 | Japanese Anime |
| CN | China | 100 | ~5,000 | Donghua / Manhua adaptations |
| KR | Korea | 60 | ~3,000 | Manhwa-based anime |
| IN | India | 20 | ~1,000 | Indian animation |

---

## 26. Auto-Ingest Pipeline (GitHub Actions) (May 2026)

Hands-off automated content ingestion. Runs every 6 hours via GitHub Actions to keep the catalog fresh with no manual intervention.

### Components

**Script:** `scripts/autoIngest.js`
**Workflow:** `.github/workflows/auto-ingest.yml`

### What It Fetches Each Run

| Source | Endpoint | Records | Filter |
|--------|----------|---------|--------|
| **Airing TV Shows** | TMDB `/tv/on_the_air` | 60 (3 pages × 20) | currently airing this week |
| **Digital Movies** | TMDB `/discover/movie` | 60 (3 pages × 20) | `primary_release_date.lte = today - 60 days`, `vote_count >= 50`, `vote_average >= 5.0` |
| **Releasing Anime** | AniList GraphQL | 50 | `status: RELEASING`, sorted by `UPDATED_AT_DESC` |

The 60-day filter on movies ensures only **digitally available** content gets imported — no theatrical-only/CAM-rip risk.

### Trigger Configuration

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'   # every 6 hours
  workflow_dispatch: {}     # manual trigger from Actions tab
```

### Concurrency Guard

```yaml
concurrency:
  group: auto-ingest
  cancel-in-progress: true
```

If a run is already executing when the next cron fires, the older run is cancelled and the new one starts fresh.

### Required GitHub Secrets

Set these in **Repo → Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGO_URI` | Same as above (alternate name) |
| `TMDB_API_KEY` | TMDB v3 API key |

### Upsert Logic

- **Filter:** `{ $or: [{ tmdbId }, { tmdb_id: tmdbId }] }` for movies/TV, `{ $or: [{ anilistId }, { anilist_id }] }` for anime
- **Strategy:** `findOneAndUpdate` with `upsert: true, setDefaultsOnInsert: true`
- **Null safety:** `pruneNullIds()` strips zero/null ID fields before write
- **Duplicate-key recovery:** On `code: 11000`, retries without the conflicting ID

### Manual Run

```bash
# Locally
npm run ingest

# From GitHub UI
Actions tab → "Auto-Ingest Pipeline" → "Run workflow"
```

### Monitoring

The GitHub Actions log shows full output including per-source counts:
```
INGEST COMPLETE
New records added  : 12
Existing updated   : 148
TV shows processed : 60
Movies processed   : 60
Anime processed    : 50
Elapsed            : 89s
```

---

## Quick Start Commands

```bash
# Clone/fresh start
npm install

# Run locally (development)
npm run dev

# Test health
curl http://localhost:5001/health

# ── Mass Seed (Legacy — 50K) ──
npm run seed              # All phases
npm run seed:movies       # Movies only (~35 min)
npm run seed:tv           # TV only (~35 min)
npm run seed:anime        # Anime + AniList (~8 hrs)
npm run seed:dry          # Dry run

# ── Mass Seed (Matrix — 100K) ──
npm run seed:hollywood    # EN movies + TV
npm run seed:anime-global # JA anime + Donghua
npm run seed:asian-drama  # C-Dramas + Thai
npm run seed:indian       # Bollywood + South Indian
npm run seed:networks     # Netflix + Prime
npm run seed:mega         # ALL profiles (full 100K run)

# ── Database Maintenance ──
npm run heal:anime:dry    # Preview AniList ID healer
npm run heal:anime        # Run AniList ID healer (~3-4 hrs for 9K records)
npm run cleanup:anime:dry # Preview orphaned anime cleanup
npm run cleanup:anime     # Delete orphaned anime (asks "YES" confirm)

# ── Regional AniList Import ──
npm run import:anime      # All regions: JP → CN → KR → IN
npm run import:anime:jp   # Japan only
npm run import:anime:cn   # China (Donghua) only
npm run import:anime:kr   # Korea only
npm run import:anime:in   # India only

# ── Auto-Ingest (one-shot) ──
npm run ingest            # Run auto-ingest pipeline locally

# Sync TMDB via API (requires admin auth, 20 records)
curl -X POST http://localhost:5001/api/sync \
  -H "Authorization: Bearer YOUR_JWT"

# Build for production
npm run build
npm start

# Deploy to Vercel
vercel deploy --prod
```

---

## 27. CinePulse Platform Overhaul (May 2026)

A three-feature overhaul that transforms CinePulse into a Netflix-calibre streaming experience with zero-code server management, a premium home page, and dedicated browse pages.

### Feature 1: Server Health Monitor & No-Code Server Management

Embed server configuration migrated from the static `public/js/embedServers.js` into MongoDB (`embed_server_configs` collection). Admins can now manage servers entirely from the admin panel without touching code or redeploying.

**New Backend Files:**
| File | Purpose |
|------|---------|
| `backend/models/EmbedServerConfig.js` | Mongoose schema — one doc per embed server (key, name, type, priority, enabled, URL patterns, timeout, health stats) |
| `backend/models/EmbedServerHealth.js` | Probe results with 30-day TTL index |
| `backend/services/serverConfigService.js` | CRUD + seeding + 5-min cache + priority sequence invariant |
| `backend/services/serverHealthService.js` | Probing, classification (Working/Degraded/Down), rolling stats, notifications |
| `backend/routes/adminServers.js` | 7 admin endpoints + 1 public read-only endpoint |

**Admin Dashboard:**
- Live status cards (green/amber/red badges) with success rate %, avg load time, last-checked timestamp
- Enable/disable toggle per server (instant, no deploy)
- Drag-and-drop + arrow reordering
- "Add Server" modal with full validation
- 60-second auto-refresh polling
- In-app notifications on status transitions (Down/Degraded/Recovered)

**Automated Health Checks:**
- Vercel Cron once daily on Hobby plan (`0 4 * * *` → `POST /api/admin/servers/health/run`)
- GitHub Actions workflow `/.github/workflows/server-health-check.yml` triggers the same endpoint every 30 minutes
- GitHub workflow auth uses `Authorization: Bearer <CRON_SECRET>` (same secret value in GitHub and Vercel)
- Parallel probing via `Promise.allSettled()`
- 30-day rolling stats (success rate, avg load time)
- Explicit cleanup pass + TTL index backstop

**API Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/servers/public` | None | Public server list for frontend |
| GET | `/api/admin/servers` | Admin | Full server list with health stats |
| POST | `/api/admin/servers` | Admin | Create new server |
| PUT | `/api/admin/servers/reorder` | Admin | Reorder by key array |
| GET | `/api/admin/servers/health` | Admin | Latest health per server |
| POST/GET | `/api/admin/servers/health/run` | Admin/Cron | Trigger health cycle |
| PUT | `/api/admin/servers/:key` | Admin | Update server fields |
| DELETE | `/api/admin/servers/:key` | Admin | Delete server |

### Feature 2: Netflix-Style Home Page Redesign

Complete overhaul of `/pages/index.html` with a premium streaming UI.

**Billboard Carousel:**
- 5 items, auto-rotates every 6 seconds
- Cross-fade transition (≤ 600ms)
- Progress dots with click-to-jump
- Pause on hover (desktop), swipe gestures (mobile)
- Deterministic match score (92–99) derived from `_id`
- Backdrop image probe with dark gradient fallback
- Strict freshness: no old-title fallback; only playable, poster-valid titles from current/previous year are eligible

**Horizontal Scroll Rails (11 total, in order):**
1. Continue Watching (localStorage-driven)
2. Trending This Week
3. New Releases
4. Top Rated
5. Premium Series
6. Elite Anime
7. Hollywood
8. K-Drama
9. Chinese (Donghua)
10. Hindi Dubbed
11. Recommended For You

Each rail has a "See All →" link to the corresponding browse page. Empty rails auto-hide.

**Category Filter Bar:**
- Pills: All, Hollywood, Anime, Chinese (Donghua), K-Drama, Hindi Dubbed
- Filters billboard + recommended/spotlight/poster grids simultaneously
- URL query param sync without page reload
- Mobile: horizontal scroll (no wrapping)

**Card Design:**
- 2:3 poster aspect ratio at all viewport sizes
- Hover-expand (1.08×) gated to `@media (hover: hover) and (pointer: fine)`
- Overlay with title, rating, genre tags, Play button
- Dark placeholder on image load failure
- Only playable items rendered (`canPlay()` filter)

### Feature 3: Netflix-Style Browse Pages

Six dedicated pages at `/browse/movies`, `/browse/anime`, `/browse/series`, `/browse/kdrama`, `/browse/chinese`, `/browse/hindi`.

**New Files:**
| File | Purpose |
|------|---------|
| `public/pages/browse.html` | Shared template for all 6 routes |
| `public/js/browse.js` | Category detection, hero, breadcrumb, infinite scroll, filter sidebar, search, subbed/dubbed toggle |
| `backend/routes/browse.js` | `GET /api/browse/:category` with 11 filter params |

**Features:**
- Breadcrumb navigation (`Home › {Category}`) with `aria-label` accessibility
- Category hero banner with per-category gradient
- Infinite scroll via `IntersectionObserver` (200px rootMargin, 24 items/page)
- Advanced filter sidebar: Genre (20 options), Year range, Rating range, Language, Status, Sort By
- Active filter pills with × remove + "Clear All"
- In-category search (300ms debounce, 2-char minimum)
- Subbed/Dubbed toggle (anime only)
- Mobile: sidebar as slide-in drawer with sessionStorage persistence
- Tap-to-retry on mid-pagination failures
- "You've reached the end" message when all items loaded

**Browse API:**
```
GET /api/browse/:category?page=1&limit=24&genre=Action,Drama&yearMin=2020&yearMax=2026&ratingMin=7&language=en,ja&status=Ongoing&sortBy=rating&q=naruto&subDub=subbed
```
Returns: `{ items, total, page, totalPages, hasMore }`

### Frontend MongoDB-Fetch Mode

`public/js/embedServers.js` now supports an opt-in `EmbedServers.loadFromMongoDB()` that fetches the live server list from `GET /api/admin/servers/public` and rebuilds `STANDARD_SERVERS` / `ANIME_SERVERS` in place. Falls back silently to the hardcoded list on any failure.

### Updated vercel.json

```json
{
  "rewrites": [
    { "source": "/browse/:category", "destination": "/pages/browse.html" },
    // ... existing rewrites
  ],
  "crons": [
    { "path": "/api/sync",                     "schedule": "0 3 * * *" },
    { "path": "/api/sync/anime",               "schedule": "30 3 * * *" },
    { "path": "/api/admin/servers/health/run", "schedule": "0 4 * * *" }
  ]
}
```

### New MongoDB Collections

| Collection | Purpose | TTL |
|------------|---------|-----|
| `embed_server_configs` | Server configuration (12 docs seeded on first run) | None |
| `embed_server_health` | Probe results | 30 days (TTL index on `checkedAt`) |

### Environment Variables (New)

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_CHECK_PROBE_TMDB_ID` | `577922` (Tenet) | TMDB ID used for health probes |
| `HEALTH_CHECK_PROBE_ANILIST_ID` | `1` (Cowboy Bebop) | AniList ID used for health probes |
| `CRON_SECRET` | _(set manually)_ | Shared secret for cron auth (required for Vercel cron + GitHub 30-min health workflow) |

### GitHub Actions Secrets (Server Health Check)

Required repository secret:
- `CRON_SECRET` — must exactly match Vercel `CRON_SECRET`

Not required anymore:
- `HEALTH_CHECK_URL` (workflow now hardcodes the production endpoint to avoid malformed secret input)

---

*Last Updated: May 17, 2026*
*Platform: CinePulse (formerly CineStream)*
*Database: 107,810+ documents (Live on Atlas)*
*Status: Netflix-Style Overhaul + Fresh Catalog + Server Health Monitor - LIVE (Vercel daily + GitHub Actions every 30 min)*
*Maintained by: Nitin Mishra & AI Coding Assistant*

---

## 28. Elite Netflix-Style UI & Dark Catalog Overhaul (May 2026)

Successfully completed a major frontend & backend overhaul to transform the platform into a high-density, premium Netflix-inspired layout, while introducing a secure "Search-Only / Dark Catalog" architecture to keep non-featured movies out of core homepage views.

### 1. Glassmorphic Navigation & Mega-Dropdowns
- **Aesthetics:** Styled a top-navigation header using a dark, premium frosted glass effect (`background: rgba(15, 15, 16, 0.85); backdrop-filter: blur(14px);`).
- **Interactive Mega Dropdowns:** Replaced default static navigation buttons with beautiful multi-column CSS Grid "Mega Dropdowns" that dynamically fade/slide-in on hover, neatly organizing Movies (Regions/Genres) and Series (Continue/Trending).
- **Search Capsule:** Rendered a modern capsule search bar with rounded borders and responsive focus scaling.
- **Files Modified:** `public/pages/index.html`, `public/pages/movie-details.html`, `public/css/styles.css`.

### 2. 70/30 Asymmetric "Slidey" Hero Showcase
- **Asymmetric Layout:** Swapped the legacy homepage spotlight with a premium 70/30 layout. The left column (70%) serves as a massive wide billboard, while the right column (30%) hosts an interactive "Up Next" queue.
- **Auto-Rotation Engine (`public/js/slideyEngine.js`):** Built a zero-dependency automated slidey engine that rotates featured content every 7 seconds, pre-fetches upcoming details, handles cross-fade transitions, and lets users manually click to swap.
- **Files Added/Modified:** `public/js/slideyEngine.js` [NEW], `public/pages/index.html`, `public/css/styles.css`.

### 3. High-Density Hover Cards
- **Micro-Interactions:** Custom `.movie-card` scaling `1.06x` on hover paired with a deep red high-contrast outer shadow glow (`rgba(229, 9, 20, 0.5)`).
- **Dynamic Slide-up Details:** Overhauled `createMovieCard` in `public/js/app.js` to render a translucent backdrop overlay on hover. This smoothly slides up from the bottom to display the release year, category pill, and a premium center play icon.
- **Files Modified:** `public/js/app.js`, `public/css/styles.css`.

### 4. Cinematic Watch Page Restructure
- **70/30 Side-by-Side Grid:** Migrated `movie-details.html` to a 70/30 split screen. The left 70% handles the large cinematic media player stage, movie info, detailed meta tags, and cast lists.
- **Sticky Sidebar (30%):** Houses the Server Switching panel and the Anime/Series episode grid side-by-side, locked to `position: sticky` so users can browse seasons/episodes without losing track of playback.
- **Files Modified:** `public/pages/movie-details.html`, `public/css/styles.css`.

### 5. Premium Ingestion Engine (`scripts/seedPremium.js`)
- **TMDB Pipeline:** Added a dedicated node script fetching high-demand content via three distinct pathways: Weekly Trending, Top Rated (7.5+), and Modern Discoveries (2024 Popular).
- **Data Mapping & Deduplication:** Maps API data directly to the Mongoose schema (handling baseline views, 16:9 thumbnails, backdrop banners, release years, etc.) and performs a smart, duplicate-free `updateOne` upsert on `tmdbId`.
- **Files Added:** `scripts/seedPremium.js` [NEW].

### 6. Search-Only "Dark Catalog" Architecture
- **Schema Update:** Indexed the `isFeatured` boolean flag directly in Mongoose to support lightning-fast lookups on 100k+ records.
- **Homepage Lockdown:** Injected `{ isFeatured: true }` strictly into the backend MongoDB `.find()` query parameters in `backend/routes/movies.js` (including GET `/` and `/trending` routes) so home rails remain exclusive to handpicked features.
- **Open Search/Browse:** Ensured search endpoints (`/api/movies/search`) and Browse grids (`/api/browse/:category`) bypass this restriction completely, allowing the complete "dark catalog" of tens of thousands of movies to remain discoverable on demand.
- **Files Modified:** `backend/models/Movie.js`, `backend/routes/movies.js`.

---

## 29. CinePro Microservice Integration & Native Bridge (May 2026)

Successfully integrated the separate **CinePro Broker Microservice** (running in the `cine pro org` workspace) with the main CinePulse platform, securing highly-redundant scraping pathways across 14+ providers.

### 1. The Native Bridge Route
* **Location:** `backend/routes/watch.js` -> `GET /api/watch/native/:category/:tmdbId`
* **Purpose:** Acts as a backend proxy between the client browser and the CinePro microservice. This prevents CORS and local development sandbox security issues by proxying all requests through CinePulse on port `5001`.
* **API Wrapper Format:** To align with client playback conventions, the bridge intercepts CinePro's raw response and formats it into the standard wrapper:
  ```json
  {
    "success": true,
    "streams": [...],
    "subtitles": [...],
    "diagnostics": [...]
  }
  ```

### 2. High Latency & Timeout Adjustments
* **The Problem:** Scraping dozens of external providers (Videasy, Popr, VidZee, VidNest, etc.) can take up to ~9.5 seconds on a cache-miss. The legacy backend router had a hardcoded `8000ms` axios request timeout, causing frequent `502 Bad Gateway` (timeout) failures.
* **The Solution:** Raised the backend bridge axios timeout to `20000ms` (`20s`) to let CinePro fully scrape the providers, safely cache the results, and deliver healthy stream arrays without early connection termination.

### 3. Local Operational Checklist for Future Agents
When running tests or verifying playback, both servers must run concurrently:

1. **Terminal 1: CinePro Broker Microservice**
   ```bash
   cd "C:\Users\NITIN MISHRA\Workspace\01_Development\Active\cine pro org\core"
   npm start
   ```
   *(Running on port `3000`)*

2. **Terminal 2: Main CinePulse Backend**
   ```bash
   cd "C:\Users\NITIN MISHRA\Workspace\01_Development\Active\cine-stream-platform-main.zip"
   npm start
   ```
   *(Running on port `5001`)*

3. **Terminal 3: Verification Sandbox**
   ```bash
   node scratch/verify_backend_bridge.js
   ```
   *(Fires a handshake request to `http://localhost:5001/api/watch/native/movie/27205` to ensure the bridge, broker, cache, and scraper array are 100% active).*

---

*Last Updated: May 17, 2026*
*Platform: CinePulse (formerly CineStream)*
*Database: 107,810+ documents (Live on Atlas)*
*Status: Netflix-Style Overhaul + CinePro Integration + Native Bridge - 100% Operational*
*Maintained by: Nitin Mishra & AI Coding Assistant*

---

## 30. Production Cloud Deployment & Keep-Alive Synchronization (May 2026)

Successfully deployed the entire decoupled streaming architecture into production, bridging the storefront on Vercel with a persistent scraping engine on Render, while enforcing strict high-definition database normalization and automated sleep defense.

### 1. Persistent Scraping Engine Cloud Launch (Render Platform)
- **Deployment Topology:** Uploaded and deployed the `cine-pro-org` microservice as an isolated Docker container instance on Render.
- **Latency Optimization:** Targeted the Singapore (Southeast Asia) region to guarantee the absolute lowest latency, fastest network responses, and zero-throttling lookup times for users streaming from regional ISPs.
- **Variable Injection:** Secured the engine by injecting required production environment configurations directly into the cloud container registry dashboard (`TMDB_API_KEY`, `NODE_ENV=production`).

### 2. High-Density Master Database Reset & Re-Seed
- **Destructive Purge Pass:** Automated a clean wipe command (`await Movie.deleteMany({});`) inside `scripts/seedPremium.js` to clear out older conflicting record sets and ensure absolute structural consistency.
- **Key-Unification & Anti-Block Proxy:** Re-executed the premium ingestion loop across Trending, Top Rated, and Modern Releases, explicitly saving fields (`posterUrl`, `thumbnailUrl`, `bannerUrl`) to align perfectly with client rendering functions. 
- **Asset Resolution:** Upgraded poster layers to crisp `/w780` HD quality while wrapping all URLs in our global caching proxy shield (`https://wsrv.nl/?url=...`) to prevent regional domain blocks.

### 3. Automated Container Keep-Alive Drones (Cron-Job.org)
- **Custom Crontab Interceptor:** Bypassed UI configuration limitations on `cron-job.org` by injecting a custom shorthand crontab expression:
  `*/12 * * * *` (or explicit intervals: `0,12,24,36,48 * * * *`).
- **Cold Start Elimination:** Configured a lightweight `GET` request pinging our base Render service root URL every 12 minutes. This resets Render's 15-minute inactivity countdown sleep clock safely, keeping the container perpetually loaded in memory for instantaneous user playback while maintaining absolute safety beneath Render's 750 free workspace hour threshold.

### 4. Cross-Cloud Infrastructure Bridging (Vercel Integration)
- **Environment Handshake:** Linked our live frontend presentation storefront on Vercel with our live background scraping worker by adding the secure cloud production string to Vercel's configuration panel:
  `CINEPRO_URL=https://cine-pro-org.onrender.com`
- **Compilation Rebuild:** Triggered a full production redeployment of the main platform web storefront to bind the environmental variables, unlocking multi-source, native, ad-free streaming playback live on the web.

---

## 31. Elite Stream Synchronization, Secure Sandboxing & Database Re-Seeding (May 2026)

Perfected the decoupled streaming architecture by implementing a hybrid stream co-existence model, locking down iframe redirection scripts with conditional sandboxing, and re-seeding the platform with pristine high-definition movie sets.

### 1. Hybrid Unified Playback & Co-Existence Model
- **Direct & Embed Merging:** Refactored the core player handshake engine inside `public/js/movieDetailsPage.js` to build both native resolved direct stream lists and fallback embed server lists simultaneously.
- **Visual Selector Indexing:** Engineered a dynamic relabeling phase inside `public/js/embedServers.js` to sort standard embed servers by priority first, then assign sequential `Server 1` through `Server N` button titles.
- **Server Priority Hierarchy:** Realigned the backend priority weights (`backend/routes/watch.js`) to mirror the frontend perfectly:
  1. **Server 1 (Primary / Direct HLS):** Live scrapers from CinePro (`https://cine-pro-org.onrender.com`) load natively in our HTML5 player with ad-free controls.
  2. **Server 2 (VidLink Fallback):** Safe standard iframe player (`https://vidlink.pro`).
  3. **Server 3 (VidNest Fallback):** Backup provider (`https://vidnest.fun`).
  4. **Server 4 to N (Lower-tier Embeds):** Sandbox-isolated fallback engines (`vidsrcio`, `embed2`, `videasy`, etc.).

### 2. High-Fidelity Smart Sandboxing Architecture
- **Tab-Redirection Protection:** Isolated low-quality, redirect-heavy embed servers (like `vidsrcio`, `vidsrcicu`, `videasy`) by forcing a robust browser iframe sandbox:
  `sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-presentation"`
- **Parent Isolation:** This lets players execute their inner playback scripts while strictly blocking frame-busting top-level redirects to external ads/spam search pages.
- **Clean Bypass:** Kept premium servers like `vidlink` and `vidnest` sandbox-free to avoid playback blocks, achieving absolute security with zero functional loss.

### 3. Pristine Premium Ingestion Engine
- **Destructive Metadata Seed:** Configured `scripts/seedPremium.js` to execute a complete MongoDB metadata cleanup pass to eliminate old key conflicts.
- **Proxy Caching & Ingestion:** Upserted hundreds of modern movies across Trending, Top Rated, and Discover categories. Automatically mapped and routed all images (`posterUrl`, `thumbnailUrl`, `bannerUrl`) through our global cache proxy (`https://wsrv.nl/?url=...`) to ensure posters load instantly on home rails without ISP/DNS blocking.

---

*Last Updated: May 18, 2026*
*Platform Status: 100% Operational & Production-Hardened*
*Maintained by: Nitin Mishra & AI Coding Assistant*

---

## 32. Elite 7-Server Architecture & Player Stability Overhaul (May 2026)

Completely redesigned the streaming server infrastructure to enforce a strict, deterministic 7-server maximum layout with zero auto-switching and universal security sandboxing.

### 1. Strict 2-Native + 5-Embed Architecture
- **Server 1 & 2**: Always reserved for CinePro Native Direct Streams (ad-free `.m3u8` HLS via the Render-deployed microservice).
- **Server 3–7**: Five curated, internet-favored embed providers: VidLink (`vidlink.pro`), VidSrc Net (`vidsrc.net`), 2Embed (`2embed.cc`), AutoEmbed (`player.autoembed.cc`), VidSrc In (`vidsrc.in`).
- **Hard Cap Enforcement**: `buildHydraSources()` in `embedServers.js` now hard-caps output to exactly 5 entries with `sources.slice(0, 5)`, making it impossible for any code path to produce more than 7 total servers.
- **Files Modified:** `public/js/embedServers.js`, `public/js/movieDetailsPage.js`, `backend/routes/watch.js`.

### 2. Eliminated Auto-Server Cycling
- **Root Cause**: Both `wireNativeFallback()` functions had `video.addEventListener('error')` handlers that automatically cycled through every server on failure, causing rapid visual thrashing in the UI.
- **Fix**: Replaced auto-switch with a static error message: "Server failed to load. Try another server from the list." Users now manually select servers, providing a stable, predictable experience.
- **Files Modified:** `public/js/movieDetailsPage.js` (two locations: line ~890 and line ~2496).

### 3. Universal Sandbox Enforcement
- **Root Cause**: The old sandbox logic had a fallback path (`frame.removeAttribute('sandbox')`) that removed ALL protection for unknown providers, allowing ad redirects and notification permission prompts.
- **Fix**: ALL embed iframes now receive smart sandbox by default:
  ```
  sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-presentation"
  ```
  This blocks `allow-top-navigation` (prevents redirect hijacking) and `allow-popups` (prevents notification prompts and ad tabs).
- **Exception**: Only VidLink (`vidlink`) gets sandbox removed because it explicitly rejects sandboxed iframes.
- **Files Modified:** `public/js/movieDetailsPage.js`.

### 4. Episode Playback Path Fix
- **Root Cause**: The episode playback handler (inside `loadEpisodes`) passed raw `hydraSources` directly to `playbackSources` without any truncation cap, causing 20+ servers to appear when MongoDB-loaded server configs merged with hardcoded ones.
- **Fix**: Added `hydraSources.slice(0, 5)` and unified label assignment before assigning to `playbackSources`.
- **Files Modified:** `public/js/movieDetailsPage.js`.

### 5. Synchronized Priority Maps
- Both frontend (`PROVIDER_PRIORITY_OVERRIDES` in `embedServers.js`) and backend (`PROVIDER_PRIORITY_OVERRIDES` in `watch.js`) now share identical priority weights:
  - `vidlink: 1`, `vidsrcnet: 2`, `embed2: 3`, `autoembed: 4`, `vidsrcin: 5`
  - Anime fallbacks start at priority 100+.

### 6. Mega Premium Movie Seeding
- Executed `scripts/seedMegaPremium.js` to populate the database with **7,125 unique, premium movies** across Popular, Top Rated, and Modern Discover (2022–2025) categories.
- All images routed through `wsrv.nl` proxy for ISP bypass.
- All records set `isFeatured: true` for immediate homepage visibility.

---

## 33. Admin Server Management & Premium 3-Server Seeding (May 2026)

Successfully completed the implementation of full Server CRUD capability inside the **Server Health Dashboard** and pre-registered three high-priority streaming servers in the production database.

### 1. Pre-Seeded Premium Streaming Servers
Created and executed a dedicated migration script (`scratch/add_new_servers.js`) to automatically pre-load and prioritize the 3 best ad-free / sandboxed embed providers in MongoDB, establishing a highly stable baseline for the player:
* **Priority 1**: `VidLink` (Key: `vidlink` | `https://vidlink.pro`)
* **Priority 2**: `VidSrc Net` (Key: `vidsrcnet` | `https://vidsrc.net`)
* **Priority 3**: `AutoEmbed` (Key: `autoembed` | `https://player.autoembed.cc`)

### 2. Full Server Deletion Capability (Dashboard UI)
Enhanced the admin dashboard panel (`public/js/serverHealthDashboard.js`) to expose complete deletion controls directly to administrators:
* **Trash Controls**: Added a red trash icon (`ri-delete-bin-line` icon from Remixicon) next to the controls on every server card.
* **Double-Safety Confirmation**: Prompts a browser confirmation dialog (`confirm()`) before executing any destructive actions.
* **REST Deletion Hook**: Dispatches a secure `DELETE /api/admin/servers/:key` API request, automatically removing the entry from MongoDB.
* **Contiguous Auto-Renumbering**: Triggers a backend sorting and priority shift phase upon deletion to guarantee the priority sequence invariant ([1..N]) remains perfectly gapless and contiguous.
