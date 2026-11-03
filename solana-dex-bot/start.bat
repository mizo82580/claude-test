@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Solana DEX Bot

where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing packages, first run only...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed & pause & exit /b 1 )
)

if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example - edit it, then run this file again.
  notepad .env
  pause
  exit /b 0
)

node src\index.js
pause
