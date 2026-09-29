@echo off
setlocal EnableExtensions
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\creer-raccourci.ps1" -Root "%~dp0"
if errorlevel 1 (
  echo Impossible de creer le raccourci NIKOUS sur le Bureau.
  pause
  exit /b 1
)
echo Raccourci NIKOUS cree sur le Bureau.
pause
exit /b 0
