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
12. [Common Tasks](#12-common-tasks)
13. [Known Issues & Solutions](#13-known-issues--solutions)

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

### Sync TMDB Content
```bash
curl -X POST https://your-api.com/api/sync \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Sync Anime
```bash
curl -X POST "https://your-api.com/api/sync/anime?limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Add New Embed Server
Edit `public/js/embedServers.js`:
```javascript
const EMBED_SERVERS = [
  { name: 'NewServer', url: 'https://newserver.to/embed/...' },
  // ...existing servers
];
```

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
**Solution**: Check `.env`:
```env
FRONTEND_URL=https://your-domain.vercel.app
```
Add to allowed origins in `backend/config/env.js`.

### Issue: MongoDB Connection Timeout (Serverless)
**Solution**: 
- Ensure DB connection middleware runs before each request
- Use connection caching in `backend/database/db.js`
- Set appropriate pool sizes in `.env`

### Issue: Admin Login Not Working
**Cause**: Password mismatch or admin doesn't exist.

**Solution**:
1. Check `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
2. Server auto-creates admin on first run
3. Restart server after changing credentials

---

## Quick Start Commands

```bash
# Clone/fresh start
npm install

# Run locally
npm run dev

# Test health
curl http://localhost:5001/health

# Sync TMDB (requires admin auth)
curl -X POST http://localhost:5001/api/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT"

# Build for production
npm run build
npm start

# Deploy to Vercel
vercel deploy --prod
```

---

*Last Updated: May 2026*
*Maintained by: Development Team*