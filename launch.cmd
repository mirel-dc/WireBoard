@echo off
setlocal
set "WIREBOARD_BIN=%~dp0wireboard.exe"
if not exist "%WIREBOARD_BIN%" set "WIREBOARD_BIN=%~dp0target\release\wireboard.exe"
if not exist "%WIREBOARD_BIN%" (
  echo Wireboard binary is missing. Build with npm.cmd run release.
  exit /b 1
)
"%WIREBOARD_BIN%" serve --open %*
exit /b %errorlevel%
