@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -Sta -ExecutionPolicy Bypass -File "%~dp0invoice-pdf-helper.ps1"
echo.
pause
