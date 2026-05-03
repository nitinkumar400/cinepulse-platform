@echo off
echo Adding environment variables to Vercel...
echo.

echo [1/7] Adding MONGODB_URI...
echo mongodb+srv://nitin8451mishra_db_user:1R8TsrtTrgZ5p6Y5@cinestream.wtfnhao.mongodb.net/cinestream?retryWrites=true^&w=majority^&appName=CineStream | vercel env add MONGODB_URI production --yes

echo [2/7] Adding JWT_SECRET...
echo cine-stream-jwt-secret-nitin-mishra-2024-secure | vercel env add JWT_SECRET production --yes

echo [3/7] Adding TMDB_API_KEY...
echo 20d1c59070517cff9c94dfd09624a7e0 | vercel env add TMDB_API_KEY production --yes

echo [4/7] Adding ADMIN_EMAIL...
echo nitinmishra0105@gmail.com | vercel env add ADMIN_EMAIL production --yes

echo [5/7] Adding ADMIN_PASSWORD...
echo Nitin@9621 | vercel env add ADMIN_PASSWORD production --yes

echo [6/7] Adding NODE_ENV...
echo production | vercel env add NODE_ENV production --yes

echo [7/7] Adding FRONTEND_URL...
echo https://cine-stream-ruby.vercel.app | vercel env add FRONTEND_URL production --yes

echo.
echo ==========================================
echo All environment variables added!
echo Now run: vercel --prod
echo ==========================================
pause
