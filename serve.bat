@echo off
title Shadowland - localhost:8080
cd /d "%~dp0"
echo.
echo   Shadowland local server
echo   http://localhost:8080
echo   (close this window to stop the server)
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080"

py --version >nul 2>&1 && (py serve.py & goto :end)
python --version >nul 2>&1 && (python serve.py & goto :end)
where npx >nul 2>&1 && (npx --yes http-server -p 8080 -c-1 & goto :end)

echo   [!] Python or Node.js is required.
echo       Install Python from https://www.python.org/downloads/
pause
:end
