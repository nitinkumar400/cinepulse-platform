@echo off
echo ==========================================
echo Push Cine Stream to GitHub
echo ==========================================
echo.

REM Check if git is installed
git --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed!
    echo Please install Git from: https://git-scm.com/download/win
    pause
    exit /b 1
)

echo Step 1: Checking git status...
git status --short

echo.
echo Step 2: Adding all files...
git add -A

echo.
echo Step 3: Committing...
git commit -m "Ready for Vercel deployment - v2"

echo.
echo ==========================================
echo GitHub Repository Setup
echo ==========================================
echo.
echo You need to create a GitHub repository first:
echo.
echo 1. Go to: https://github.com/new
echo 2. Repository name: cine-stream
echo 3. Click "Create repository"
echo 4. Copy the HTTPS URL (e.g., https://github.com/YOUR_USERNAME/cine-stream.git)
echo.
set /p GITHUB_URL="Paste your GitHub repo URL here: "

echo.
echo Step 4: Adding remote...
git remote remove origin 2>nul
git remote add origin %GITHUB_URL%

echo.
echo Step 5: Pushing to GitHub...
git branch -M main
git push -u origin main

echo.
echo ==========================================
if %errorlevel% == 0 (
    echo SUCCESS! Code pushed to GitHub!
    echo.
    echo Now go to Vercel:
    echo https://vercel.com/new
echo    and import your GitHub repository
) else (
    echo ERROR: Push failed!
    echo Make sure you have access to the repository
    echo You may need to enter your GitHub credentials
)
echo ==========================================
pause
