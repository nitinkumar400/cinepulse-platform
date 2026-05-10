const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const os = require('os');
const path = require('path');

const connectDB = require('./database/db');
const { getMongoHealth } = require('./database/db');
const logger = require('./config/logger');
const { protect, adminOnly } = require('./middleware/authMiddleware');
const { ensureAdminAccount } = require('./services/adminBootstrapService');
const {
  getCorsOrigins,
  getCanonicalHost,
  getEnv,
  getFrontendOrigin,
  getNumberEnv,
} = require('./config/env');
const responseFormatter = require('./middleware/responseFormatter');
const { requestContext } = require('./middleware/requestContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { globalApiLimiter, authLimiter, movieLimiter, aiLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const movieRoutes = require('./routes/movies');
const watchRoutes = require('./routes/watch');
const episodeRoutes = require('./routes/episodes');
const commentRoutes = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');
const anilistRoutes = require('./routes/anilist');
const tmdbRoutes = require('./routes/tmdb');
const tmdbPublicRoutes = require('./routes/tmdbPublic');
const analyticsRoutes = require('./routes/analytics');
const subtitleRoutes = require('./routes/subtitleRoutes');
const recommendRoutes = require('./routes/recommend');
const userRoutes = require('./routes/users');
const { aiRouter } = require('./routes/aiRoutes');
const mcpRoutes = require('./routes/mcp');
const syncRoutes = require('./routes/sync');
const Movie = require('./models/Movie');

const app = express();
const HOST = getEnv('HOST', '0.0.0.0');
const PORT = getNumberEnv('PORT', 5001);
const runtime = getEnv('NODE_ENV', 'development').toLowerCase();
const frontendOrigin = getFrontendOrigin();
const canonicalHost = getCanonicalHost();
const corsOrigins = getCorsOrigins();
const pagesDir = path.join(__dirname, '../public/pages');
const servePage = (fileName) => (req, res) => res.sendFile(path.join(pagesDir, fileName));
const htmlPageMap = {
  'index.html': 'index.html',
  'login.html': 'login.html',
  'admin.html': 'admin.html',
  'dashboard.html': 'dashboard.html',
  'profile.html': 'profile.html',
  'search.html': 'search.html',
  'offline.html': 'offline.html',
  'movie-details.html': 'movie-details.html',
  'episode.html': 'episode.html',
  'player.html': 'player.html',
  'anilist-import.html': 'anilist-import.html',
  'tmdb-import.html': 'tmdb-import.html',
  'embed-demo.html': 'embed-demo.html',
};

function wrapLayerHandlers(stack = []) {
  for (const layer of stack) {
    if (layer.route && Array.isArray(layer.route.stack)) {
      wrapLayerHandlers(layer.route.stack);
      continue;
    }

    if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
      wrapLayerHandlers(layer.handle.stack);
      continue;
    }

    const original = layer.handle;
    if (typeof original !== 'function' || original.__wrappedAsync) {
      continue;
    }

    layer.handle = function wrappedAsyncHandler(req, res, next) {
      try {
        const maybePromise = original(req, res, next);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch(next);
        }
      } catch (error) {
        next(error);
      }
    };
    layer.handle.__wrappedAsync = true;
  }
}

function corsOriginHandler(origin, callback) {
  // Allow requests with no origin (mobile apps, curl, server-to-server)
  if (!origin) return callback(null, true);
  
  // Allow all origins if wildcard is configured
  if (corsOrigins.includes('*')) return callback(null, true);
  
  // Allow if origins list is empty (development) or includes this origin
  if (corsOrigins.length === 0 || corsOrigins.includes(origin)) {
    return callback(null, true);
  }
  
  console.warn(`[CORS] Blocked origin: ${origin}. Allowed: ${corsOrigins.join(', ')}`);
  return callback(new Error(`CORS origin blocked: ${origin}`));
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    logger.error('Serverless DB connection middleware error', { error: error.message });
    res.status(500).json({ success: false, message: 'Database connection error', error: error.message });
  }
});

app.use(requestContext);
app.use(cors({
  origin: corsOriginHandler,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

app.use(helmet({
  frameguard: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  permissionsPolicy: {
    features: {
      pictureInPicture: ['*'],
      fullscreen: ['self', '*'],
    },
  },
  contentSecurityPolicy: false,
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

if (runtime === 'production' && canonicalHost) {
  app.use((req, res, next) => {
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if (!hostHeader || hostHeader === canonicalHost) return next();
    return res.redirect(308, `https://${canonicalHost}${req.originalUrl || '/'}`);
  });
}

app.use('/api', responseFormatter);
app.use('/api', globalApiLimiter);

// Ensure database connection for all API routes (serverless-safe)
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    logger.error('Database connection failed on request', { error: error.message });
    return res.status(503).json({
      success: false,
      message: 'Database connection failed. Please try again later.',
      error: { code: 'DB_CONNECTION_ERROR' },
    });
  }
});

app.get('/health', (req, res) => {
  const mongo = getMongoHealth();
  const healthy = mongo.readyState === 1;

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: 'cine-stream-backend',
    environment: getEnv('NODE_ENV', 'development'),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    dependencies: {
      mongo,
    },
  });
});

app.get('/:pageName', (req, res, next) => {
  const fileName = htmlPageMap[req.params.pageName];
  if (!fileName) {
    return next();
  }

  return res.sendFile(path.join(pagesDir, fileName));
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '7d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  },
}));

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, '../public/manifest.json'));
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const cursor = Movie.find({})
      .select('_id updatedAt')
      .sort({ updatedAt: -1 })
      .lean()
      .cursor();
    res.setHeader('Content-Type', 'application/xml');
    res.status(200);
    res.write('<?xml version="1.0" encoding="UTF-8"?>');
    res.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for await (const movie of cursor) {
      const loc = `${baseUrl}/pages/movie-details.html?id=${movie._id}`;
      const lastmod = movie.updatedAt ? new Date(movie.updatedAt).toISOString() : new Date().toISOString();
      res.write(`<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
    }
    res.write('</urlset>');
    return res.end();
  } catch (error) {
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/movies', movieLimiter, movieRoutes);
app.use('/api/watch', watchRoutes);
app.use('/api/episodes', episodeRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', protect, notificationRoutes);
app.use('/api/anilist', anilistRoutes);
app.use('/api/tmdb', tmdbRoutes);
app.use('/api/tmdb-public', tmdbPublicRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/subtitles', protect, subtitleRoutes);
app.use('/api/recommend', protect, recommendRoutes);
app.use('/api/users', protect, userRoutes);
app.use('/api/ai', aiLimiter, protect, aiRouter);
app.use('/api/mcp', mcpRoutes);
app.use('/api/sync', syncRoutes);

if (app._router && Array.isArray(app._router.stack)) {
  wrapLayerHandlers(app._router.stack);
}

app.get('/', servePage('index.html'));
app.get('/login', servePage('login.html'));
app.get('/login.html', servePage('login.html'));
app.get('/admin', servePage('admin.html'));
app.get('/admin.html', servePage('admin.html'));
app.get('/dashboard', servePage('dashboard.html'));
app.get('/dashboard.html', servePage('dashboard.html'));
app.get('/profile', servePage('profile.html'));
app.get('/profile.html', servePage('profile.html'));
app.get('/search', servePage('search.html'));
app.get('/search.html', servePage('search.html'));
app.get('/offline', servePage('offline.html'));
app.get('/offline.html', servePage('offline.html'));
app.get('/movie-details', servePage('movie-details.html'));
app.get('/movie-details.html', servePage('movie-details.html'));
app.get('/episode', servePage('episode.html'));
app.get('/episode.html', servePage('episode.html'));
app.get('/player', servePage('player.html'));
app.get('/player.html', servePage('player.html'));
app.get('/anilist-import', servePage('anilist-import.html'));
app.get('/anilist-import.html', servePage('anilist-import.html'));
app.get('/tmdb-import', servePage('tmdb-import.html'));
app.get('/tmdb-import.html', servePage('tmdb-import.html'));
app.get('/embed-demo', servePage('embed-demo.html'));
app.get('/embed-demo.html', servePage('embed-demo.html'));
app.get([
  '/signup',
  '/signup.html',
  '/verify-email',
  '/verify-email.html',
  '/verify-result',
  '/verify-result.html',
  '/check-email',
  '/check-email.html',
  '/reset-password',
  '/reset-password.html',
], (req, res) => res.redirect('/login'));

app.use('/api', notFoundHandler);
app.get('*', servePage('index.html'));
app.use(errorHandler);

async function startServer() {
  await connectDB();
  await ensureAdminAccount();

  app.listen(PORT, HOST, () => {
    const networkIp = getLocalIp();
    logger.info('CINE STREAM server started', {
      host: HOST,
      port: PORT,
      localUrl: `http://localhost:${PORT}`,
      networkUrl: `http://${networkIp}:${PORT}`,
      frontendOrigin,
      corsOrigins,
    });
  });
}

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection', {
    message: error.message,
    stack: error.stack,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    message: error.message,
    stack: error.stack,
  });
});

if (!process.env.VERCEL) {
  startServer().catch((error) => {
    logger.error('Failed to start server infrastructure', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
} else {
  // On Vercel, simply connect to DB and ensure admin
  connectDB().then(() => ensureAdminAccount()).catch(err => {
    logger.error('Vercel DB initialization failed', { error: err.message });
  });
}

// Export for Vercel serverless deployment
module.exports = app;
