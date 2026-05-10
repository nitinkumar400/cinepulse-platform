Short Deploy Checklist — CinePulse

1) Install & test locally
- Install dependencies: `npm install`
- Start dev server: `npm run dev` (dev with nodemon)
- Open movie page to verify: `http://localhost:5001/pages/movie-details.html?id=<MOVIE_ID>`

2) Essential Environment Variables (copy into Vercel Dashboard > Project > Settings > Environment Variables)
- `MONGODB_URI` (production mongo connection string)
- `JWT_SECRET`
- `TMDB_API_KEY`
- `TMDB_TOKEN` (optional)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (if using Cloudinary)
- `OPENSUB_API_KEY` (optional)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `FRONTEND_URL` (e.g., `https://your-vercel-domain.vercel.app`)
- `NODE_ENV` = `production`
- `APP_ENV` = `production`
- `VERCEL` = `1` (optional)

3) Vercel Project setup notes
- Create a new project and point to your repository (GitHub/GitLab/Bitbucket).
- Root directory: set to repository root.
- Build & Output:
  - Install step: Vercel will run `npm install` automatically.
  - Build command: leave empty if serving via backend, otherwise use `npm run build` if you have a build step.
  - Output directory: leave default (not used for serverful apps).
- Deployment type:
  - This project serves a Node backend. Use Vercel Serverless Functions only if you refactor; otherwise prefer hosting on a VPS / Heroku / Render / DigitalOcean.

4) Quick Deploy (recommended approach)
- Push to GitHub.
- On Vercel, import the GitHub repository and set the Environment Variables from step 2.
- Deploy and monitor the build logs.

5) Post-deploy checks
- Visit `https://<your-vercel-domain>/pages/movie-details.html?id=<MOVIE_ID>` and verify the Upcoming Episode card for anime pages.
- Check server logs for DB connection and API errors.

6) Troubleshooting
- If episodes grid shows spinner/empty-state: check backend `/api/movies/:id` response for `nextAiringEpisode`.
- If fonts or assets error with CORS: ensure `FRONTEND_URL` and `corsOrigins` include your Vercel domain.

