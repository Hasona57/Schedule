@echo off
setlocal enabledelayedexpansion
title Nile University Smart Timetable - Full Responsive + Light/Dark Theme
color 0B

cd /d "%~dp0"

echo ======================================================================
echo       Nile University Smart Timetable and Live Campus Navigator
echo       Version: Full Responsive (Mobile + Tablet + Desktop)
echo       Features: Dark/Light Theme, Enrolled Courses, 1-Min Live Sync
echo ======================================================================
echo.

:: 1. Check Node.js
echo [1/3] Checking Node.js installation...
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org/
    echo Once installed, double-click start.bat again.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js is installed: !NODE_VER!
echo.

:: 2. Check Python and dependencies
echo [2/3] Checking Python and sync dependencies...
set "PY_CMD="
where python >nul 2>&1
if !errorlevel! equ 0 (
    set "PY_CMD=python"
) else (
    where py >nul 2>&1
    if !errorlevel! equ 0 (
        set "PY_CMD=py"
    )
)

if "!PY_CMD!"=="" (
    echo [NOTICE] Python was not found in PATH.
    echo Python is only needed for live PowerCampus sync.
    echo The app will run in offline timetable mode.
    echo.
) else (
    :: Get Python version using temp file to avoid escaping issues
    !PY_CMD! --version > "%TEMP%\nu_pyver.txt" 2>&1
    set /p PY_VER=<"%TEMP%\nu_pyver.txt"
    del "%TEMP%\nu_pyver.txt" >nul 2>&1
    echo [OK] !PY_VER! found.

    :: Fast check: are requirements already installed?
    !PY_CMD! -c "import requests, bs4, urllib3" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] All Python dependencies are already installed.
    ) else (
        echo [INFO] Installing missing Python dependencies...
        !PY_CMD! -m pip install -r "%~dp0requirements.txt" --no-warn-script-location
        if !errorlevel! equ 0 (
            echo [OK] Python dependencies installed successfully.
        ) else (
            echo [WARNING] Could not install some Python packages. Continuing...
        )
    )
    echo.
)

:: 3. Launch the Server
echo [3/3] Starting Nile University Timetable Server...
echo.
echo ======================================================================
echo  Server starting at: http://localhost:3000
echo  Keep this window open while using the app.
echo  To use on phones/tablets: connect to the same Wi-Fi as this PC,
echo  then open http://YOUR-PC-IP:3000 in your phone browser.
echo  Theme: Use the toggle button top-right to switch Dark / Light mode.
echo  Press Ctrl+C to stop the server.
echo ======================================================================
echo.

:: Start the server (server.js automatically opens the browser once on ready)
node server.js

if !errorlevel! neq 0 (
    echo.
    echo [ERROR] The server stopped unexpectedly.
    echo Please check the error above and try again.
    echo.
)

pause
