@echo off
cd /d "%~dp0"
title FINDNEVNIK PWA PREVIEW
echo ==========================================
echo        FINDNEVNIK PWA - LOCAL PREVIEW
echo ==========================================
echo.
echo Open in browser: http://localhost:8080
echo Press Ctrl+C to stop.
echo.
py -m http.server 8080
pause
