@echo off
setlocal EnableExtensions
set "FOUND=0"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
  set "FOUND=1"
  taskkill /F /PID %%P >nul 2>&1
)
if "%FOUND%"=="0" echo Aucun serveur NIKOUS n'ecoute sur le port 3000.
if not "%FOUND%"=="0" echo Le serveur NIKOUS a ete arrete.
exit /b 0
