Deployment environment variables for Vercel

Copy these exactly into your Vercel project Environment Variables (Production):

- MONGODB_URI: MongoDB connection string (Atlas). Example: mongodb+srv://<user>:<pass>@cluster0.mongodb.net/dbname
- MONGO_URI: (alias) same as MONGODB_URI
- JWT_SECRET: Secret for signing JWTs (strong random string)
- TMDB_API_KEY: TMDB v3 API key (used for public TMDB requests)
- TMDB_TOKEN: TMDB v4 token (optional, if used by server)
- CLOUDINARY_CLOUD_NAME: Cloudinary cloud name
- CLOUDINARY_API_KEY: Cloudinary API key
- CLOUDINARY_API_SECRET: Cloudinary API secret
- OPENSUB_API_KEY: OpenSubtitles API key (if using subtitle sync)
- SMTP_HOST: SMTP server host for transactional emails
- SMTP_PORT: SMTP server port
- SMTP_USER: SMTP username
- SMTP_PASS: SMTP password
- FRONTEND_URL: Public frontend URL (e.g., https://your-site.vercel.app)
- NODE_ENV: set to `production`
- PORT: (optional) port the server listens on (Vercel will set its own runtime port)
 - EMAIL_USER: SMTP username used by email service (often same as `SMTP_USER`)
 - EMAIL_PASS: SMTP password used by email service (often same as `SMTP_PASS`)
 - EMAIL_FROM: From address shown in outgoing emails (e.g., "CINE STREAM <noreply@yourdomain.com>")
 - APP_ENV: optional environment label (fallback for `NODE_ENV` in some configs)
 - DOTENV_PATH: optional path to a dotenv file if you use a custom location
 - VERCEL: (optional) platform flag sometimes checked in runtime code

Notes:
- Use the "Environment" > "Environment Variables" panel in Vercel and set these for the Production environment.
- Never expose `JWT_SECRET`, DB credentials, or Cloudinary secrets in client-side code or public repos.
- If you use any additional services (analytics, sentry, redis, etc.), add their keys here as well.
