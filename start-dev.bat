@echo off
echo ==========================================
echo CINE STREAM - Local Dev Mode
echo ==========================================
echo.
echo This script starts Chrome with web security
echo DISABLED so embed servers work on localhost.
echo.
echo ⚠️  Only use for local development!
echo.

:: Find Chrome path
set CHROME_PATH=

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set CHROME_PATH="%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME_PATH (
    echo ❌ Chrome not found! Install Chrome or edit this script with your Chrome path.
    pause
    exit /b 1
)

echo ✅ Found Chrome: %CHROME_PATH%
echo.
echo Starting Chrome with disabled web security...
echo This allows embeds to load on localhost without popup.
echo.

:: Kill existing Chrome to avoid conflicts
taskkill /F /IM chrome.exe /T 2>nul
timeout /t 2 /nobreak >nul

:: Start Chrome with disabled security
start "" %CHROME_PATH% ^
    --disable-web-security ^
    --disable-site-isolation-trials ^
    --disable-features=IsolateOrigins,site-per-process ^
    --allow-running-insecure-content ^
    --disable-features=BlockInsecurePrivateNetworkRequests ^
    --user-data-dir="%TEMP%\cinestream-dev-chrome" ^
    http://localhost:5001/embed-demo

echo.
echo ✅ Chrome launched with web security disabled!
echo 🎬 Opening: http://localhost:5001/embed-demo
echo.
echo ⚠️  IMPORTANT:
echo    - This Chrome window is INSECURE (for dev only)
echo    - Do NOT log into banks/sensitive sites here
echo    - Close this window when done testing
echo.
pause
