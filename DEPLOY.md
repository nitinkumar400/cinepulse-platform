# Deploy CINE STREAM to Vercel

## Prerequisites

1. **Vercel Account**: Sign up at https://vercel.com
2. **MongoDB Atlas**: Cloud MongoDB (free tier available)
3. **Vercel CLI**: Install with `npm i -g vercel`
4. **GitHub**: Push your code to a GitHub repository

---

## Step 1: Prepare MongoDB Atlas

Since Vercel is serverless, you need cloud MongoDB:

1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Create a database user (remember username/password)
4. Get your connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/cinestream?retryWrites=true&w=majority
   ```

---

## Step 2: Prepare Your Code

### Check Files Are Ready

✅ `vercel.json` - Already configured
✅ `backend/server.js` - Exports `app` for Vercel
✅ `package.json` - Has all dependencies

### Environment Variables (Local)

Create `.env.production`:
```env
# MongoDB Atlas
MONGODB_URI=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/cinestream?retryWrites=true&w=majority

# JWT
JWT_SECRET=your-super-secret-key-here-change-in-production
JWT_EXPIRES_IN=7d

# Admin
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@cinestream.local
ADMIN_PASSWORD=Admin@12345

# TMDB
TMDB_API_KEY=your_tmdb_api_key_here

# App
NODE_ENV=production
FRONTEND_URL=https://your-vercel-domain.vercel.app
```

---

## Step 3: Push to GitHub

```bash
# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Ready for Vercel deployment"

# Add your GitHub repo
git remote add origin https://github.com/YOUR_USERNAME/cinestream.git

# Push
git push -u origin main
```

---

## Step 4: Deploy to Vercel

### Option A: Vercel Dashboard (Easiest)

1. Go to https://vercel.com/dashboard
2. Click "Add New Project"
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Other
   - **Root Directory**: `./`
   - **Build Command**: Leave blank
   - **Output Directory**: Leave blank

5. Add Environment Variables:
   - `MONGODB_URI` - Your MongoDB Atlas connection string
   - `JWT_SECRET` - Random secure string
   - `ADMIN_EMAIL` - admin@cinestream.local
   - `ADMIN_PASSWORD` - Admin@12345
   - `TMDB_API_KEY` - Your TMDB API key
   - `NODE_ENV` - production

6. Click **Deploy**

### Option B: Vercel CLI

```bash
# Login to Vercel
vercel login

# Deploy
vercel

# Add environment variables
vercel env add MONGODB_URI
vercel env add JWT_SECRET
vercel env add ADMIN_EMAIL
vercel env add ADMIN_PASSWORD
vercel env add TMDB_API_KEY
vercel env add NODE_ENV production

# Deploy to production
vercel --prod
```

---

## Step 5: Post-Deployment

### Reset Admin Account

After deployment, reset the admin account:

```bash
# In Vercel dashboard, go to your project
# Click "Functions" tab
# Run the reset script via a one-time function

# Or add this temporary route to test admin
```

### Test Your Deployment

1. Open your Vercel URL (e.g., `https://cinestream.vercel.app`)
2. Go to `/login.html`
3. Login with:
   - Email: `admin@cinestream.local`
   - Password: `Admin@12345`
4. Go to `/pages/movie-details.html?id=157336`
5. Click **VidSrc** → **Watch Now** → Video opens in popup ✅

---

## Troubleshooting

### Issue: "Cannot connect to MongoDB"
- Check MongoDB Atlas IP whitelist (allow all IPs: `0.0.0.0/0`)
- Verify connection string format

### Issue: "404 on API routes"
- Check `vercel.json` routes configuration
- Make sure API calls use `/api/` prefix

### Issue: "Frontend not loading"
- Check that `frontend/` folder exists
- Verify `vercel.json` static file serving

### Issue: "Popup blocked"
- Normal on first load, user must allow popups
- Or use ngrok for local testing

---

## Custom Domain (Optional)

1. In Vercel dashboard → Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed
4. Update `FRONTEND_URL` in environment variables

---

## Quick Reference

| What | Where |
|------|-------|
| Deploy | `vercel --prod` |
| Logs | Vercel Dashboard → Functions |
| Env Vars | Vercel Dashboard → Settings → Environment Variables |
| Custom Domain | Vercel Dashboard → Settings → Domains |

---

## Your Deployed URLs Will Be:

- **Main Site**: `https://your-project.vercel.app`
- **API**: `https://your-project.vercel.app/api/...`
- **Login**: `https://your-project.vercel.app/login.html`
- **Movies**: `https://your-project.vercel.app/pages/movies.html`
- **Embed Demo**: `https://your-project.vercel.app/pages/embed-demo.html`

---

**Need Help?** 
- Check Vercel docs: https://vercel.com/docs
- Check MongoDB Atlas docs: https://docs.mongodb.com/
- Review AGENT.md for code details
