@echo off
title Stillsong disc check
rem Reads every file on this disc and compares it with the hashes recorded
rem when the disc was made. Takes a few minutes; changes nothing.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\verify-disc.ps1"
echo.
pause
