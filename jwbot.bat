@echo off
cls
cd /d "%~dp0"
title jwbot
node src\index.js
pause >nul
exit