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

const app = express();
const HOST = getEnv('HOST', '0.0.0.0');
const PORT = getNumberEnv('PORT', 5001);
const frontendOrigin = getFrontendOrigin();
const corsOrigins = getCorsOrigins();
const pagesDir = path.join(__dirname, '../frontend/pages');
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
};

function corsOriginHandler(origin, callback) {
  if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) {
    return callback(null, true);
  }
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

app.use(requestContext);
app.use(cors({
  origin: corsOriginHandler,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

app.use(helmet({
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      styleSrcElem: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'data:', 'https:'],
      connectSrc: [
        "'self'",
        frontendOrigin,
        getEnv('OLLAMA_URL', 'http://127.0.0.1:11434/api/generate').replace(/\/api\/generate$/, ''),
        'https://api.dailymotion.com',
        'https://www.youtube.com',
      ],
      frameSrc: [
        "'self'",
        'https://www.youtube.com',
        'https://www.youtube-nocookie.com',
        'https://www.dailymotion.com',
        'https://geo.dailymotion.com',
        'https://player.vimeo.com',
      ],
    },
  },
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/api', responseFormatter);
app.use('/api', globalApiLimiter);

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
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, '../frontend/manifest.json'));
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/movies', movieLimiter, protect, adminOnly, movieRoutes);
app.use('/api/watch', protect, adminOnly, watchRoutes);
app.use('/api/episodes', protect, adminOnly, episodeRoutes);
app.use('/api/comments', protect, adminOnly, commentRoutes);
app.use('/api/notifications', protect, adminOnly, notificationRoutes);
app.use('/api/anilist', anilistRoutes);
app.use('/api/tmdb', tmdbRoutes);
app.use('/api/tmdb-public', protect, adminOnly, tmdbPublicRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/subtitles', protect, adminOnly, subtitleRoutes);
app.use('/api/recommend', protect, adminOnly, recommendRoutes);
app.use('/api/users', protect, adminOnly, userRoutes);
app.use('/api/ai', aiLimiter, protect, adminOnly, aiRouter);

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

startServer().catch((error) => {
  logger.error('Failed to start server infrastructure', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
