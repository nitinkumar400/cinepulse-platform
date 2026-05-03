@echo off
echo ==========================================
echo CINE STREAM - ngrok HTTPS Tunnel
echo ==========================================
echo.
echo This creates a public HTTPS URL for your
echo local server so embeds work in the iframe.
echo.

:: Check if ngrok is installed
where ngrok >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ngrok not found!
    echo.
    echo Install ngrok:
    echo   npm install -g ngrok
    echo   OR download from https://ngrok.com/download
    echo.
    pause
    exit /b 1
)

echo ✅ ngrok found
echo.
echo Starting HTTPS tunnel on port 5001...
echo.
echo ⏳ Wait for the URL to appear (e.g., https://abc123.ngrok.io)
echo    Then open that URL + /embed-demo in your browser
echo.
echo ⚠️  The URL changes each time you restart ngrok
echo    Free tier: 1-hour sessions, then restart
echo.

:: Start ngrok
ngrok http 5001

echo.
echo ngrok stopped. Restart to get a new URL.
pause
