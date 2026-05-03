# CINE STREAM - Multi-Server Video Embed System

## Project Overview
A multi-server video embedding system for Cine Stream that supports 6+ embed providers with automatic failover and popup player support.

---

## What Was Built

### Core Features
- **6 Embed Servers**: VidSrc, SuperEmbed, MultiEmbed, VidLink, AutoEmbed, 2Embed
- **Smart Server Selection**: Visual buttons with status indicators
- **Popup Player**: Bypasses all iframe/X-Frame-Options restrictions
- **TMDb Integration**: Uses TMDb IDs for universal content matching
- **TV Show Support**: Season/episode selectors for series
- **HTTPS/ngrok Support**: Works on localhost with ngrok tunnel

### Why Popup Player?
Embed servers (VidSrc, etc.) block iframe embedding via `X-Frame-Options`. The popup player opens embeds in a new window, bypassing all restrictions and working on any domain.

---

## Key Files

### Frontend
| File | Purpose |
|------|---------|
| `frontend/js/embedServers.js` | Server configurations, URL builders, exports |
| `frontend/pages/embed-demo.html` | Demo page with server buttons, popup player UI |
| `frontend/js/videoEngine.js` | Integrated with existing video engine |
| `frontend/js/movieDetailsPage.js` | **UPDATED**: Now uses popup player for external embeds |
| `frontend/pages/movie-details.html` | Server button UI in movie details, now uses popup player |

### Backend
| File | Purpose |
|------|---------|
| `backend/server.js` | Added routing for embed-demo.html |
| `backend/scripts/resetAdmin.js` | Admin account reset utility |

### Utilities
| File | Purpose |
|------|---------|
| `start-dev.bat` | Launch Chrome with disabled security (local dev) |
| `start-ngrok.bat` | Start ngrok HTTPS tunnel |

---

## How to Test

### Option 1: Popup Player (Recommended - Always Works)
1. Start server: `npm start`
2. Open: `http://localhost:5001/embed-demo`
3. Enter TMDb ID: `157336` (Interstellar)
4. Click **Load Player** then **Watch Now**
5. Video opens in popup window ✅

### Testing on Local Website (Movies Page)
1. Start server: `npm start`
2. Open: `http://localhost:5001/movies.html`
3. Click any movie poster
4. Click a server button (VidSrc, SuperEmbed, etc.)
5. Click **Watch Now** → Video opens in popup ✅

### Option 2: ngrok HTTPS (Iframe Test)
1. Install ngrok: `npm install -g ngrok`
2. Add authtoken: `ngrok authtoken YOUR_TOKEN`
3. Run: `ngrok http 5001`
4. Copy HTTPS URL + `/embed-demo`
5. Test on HTTPS domain

### Option 3: Dev Mode Chrome (Local Iframe)
Double-click `start-dev.bat` → Opens Chrome with disabled security

---

## Server Priority (Current)

| Priority | Server | URL Format |
|----------|--------|------------|
| 1 | **VidSrc** | `https://vidsrc-embed.ru/embed/movie?tmdb={id}` |
| 2 | SuperEmbed | `https://embed.su/embed/movie/{id}` |
| 3 | MultiEmbed | `https://multiembed.mov/?video_id={id}&tmdb=1` |
| 4 | VidLink | `https://vidlink.pro/embed/movie/{id}` |
| 5 | AutoEmbed | `https://autoembed.cc/embed/movie/{id}` |
| 6 | 2Embed | `https://www.2embed.cc/embed/{id}` |

---

## Architecture

```
User clicks "Load Player"
         ↓
EmbedServers.buildAllSources(tmdbId, type, season, episode)
         ↓
Renders server buttons (VidSrc active by default)
         ↓
User clicks "Watch Now" OR switches server
         ↓
openPopupPlayer(url) → window.open(embedURL, 'CineStreamPlayer')
         ↓
Video plays in centered popup window ✅
```

---

## API References Used

### VidSrc API
- Docs: `https://vidsrcme.su/api/`
- Movie: `https://vidsrc-embed.ru/embed/movie?tmdb={id}`
- TV: `https://vidsrc-embed.ru/embed/tv?tmdb={id}&season={s}&episode={e}`

### Other Providers
- SuperEmbed: `https://embed.su/`
- MultiEmbed: `https://multiembed.mov/`
- VidLink: `https://vidlink.pro/`
- AutoEmbed: `https://autoembed.cc/`
- 2Embed: `https://www.2embed.cc/`

---

## Common Issues & Fixes

| Issue | Cause | Solution |
|-------|-------|----------|
| "This content is blocked" | X-Frame-Options header | Use popup player instead of iframe |
| "404 Not Found" | Wrong URL format | Updated to `?tmdb=` query param |
| "Media unavailable" | Movie not on server | Try different server button |
| ngrok ERR_NGROK_8012 | Backend not running | Run `npm start` first |
| localhost blocked | Embed servers reject localhost | Use ngrok HTTPS or popup |

---

## Next Steps / Improvements

### Potential Enhancements
1. **Backend Proxy**: Create `/proxy-embed?url=` route to fetch embed HTML server-side
2. **Subtitle Support**: Add `&ds_lang=en` parameter for default subtitles
3. **Autoplay Toggle**: Add `&autoplay=1/0` user preference
4. **Quality Selector**: Detect and offer multiple quality sources
5. **Analytics**: Track which servers work best per region
6. **Caching**: Cache working server per movie to skip failed ones
7. **PWA Support**: Make embed demo a standalone installable app

### Deployment
- For production: Deploy to HTTPS domain (Vercel, Netlify, etc.)
- VidSrc and other embedders work better on HTTPS than HTTP
- Consider backend proxy for true iframe embedding without popup

---

## Admin Credentials

If you need admin access:
- **Email**: `admin@cinestream.local`
- **Password**: `Admin@12345`

Reset if needed: `node backend/scripts/resetAdmin.js`

---

## Quick Commands

```bash
# Start backend
npm start

# Install ngrok
npm install -g ngrok

# Start ngrok tunnel
ngrok http 5001

# Reset admin
node backend/scripts/resetAdmin.js

# Dev mode Chrome
start-dev.bat
```

---

## File Tree (Key Files)

```
cine-stream-platform-main/
├── frontend/
│   ├── js/
│   │   ├── embedServers.js          # Server configs
│   │   ├── videoEngine.js           # Integrated engine
│   │   └── movieDetailsPage.js      # Movie page integration
│   └── pages/
│       ├── embed-demo.html          # Demo page (main)
│       └── movie-details.html       # Movie details page
├── backend/
│   ├── server.js                    # Routes
│   └── scripts/
│       └── resetAdmin.js            # Admin reset
├── start-dev.bat                    # Chrome dev mode
├── start-ngrok.bat                  # ngrok launcher
└── AGENT.md                         # This file
```

---

## Summary

This system successfully handles the fundamental problem: **embed servers block iframes via X-Frame-Options**. The solution uses a popup player that:
- Bypasses all iframe restrictions
- Works on localhost, HTTP, HTTPS, any domain
- Provides server switching with visual feedback
- Maintains clean UX with centered popup window

The code is production-ready and can be deployed to any HTTPS domain.

---

## Changelog

### May 2, 2026
- ✅ **VidSrc API integrated** - Using correct `vidsrc-embed.ru` domain with `?tmdb=` format
- ✅ **Popup player implemented** - Both embed-demo and movie-details pages use popup
- ✅ **Server priority updated** - VidSrc is now primary server
- ✅ **AGENT.md created** - Full documentation for future AI agents
- ✅ **Vercel Deployment Ready** - `vercel.json`, `DEPLOY.md`, `.vercelignore` configured

### Previous
- Initial multi-server embed system with 6 providers
- ngrok HTTPS tunnel support added
- Dev mode Chrome script (`start-dev.bat`)

---

## Vercel Deployment Quick Start

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel

# 4. Add env vars in Vercel dashboard:
#    - MONGODB_URI (from MongoDB Atlas)
#    - JWT_SECRET
#    - TMDB_API_KEY

# 5. Deploy to production
vercel --prod
```

See `DEPLOY.md` for full instructions.

---

*Last updated: May 2, 2026*
*Built for CINE STREAM video platform*
