@echo off
title Stillsong setup
rem Copies the studio components from this disc, then runs the installer.
rem Everything it does is described in README.txt beside this file.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\seed-components.ps1"
echo.
if errorlevel 1 (
  echo Setup did not finish. The messages above say why.
) else (
  echo You can close this window.
)
pause
