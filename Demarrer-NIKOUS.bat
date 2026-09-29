@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto NODE_MISSING
for /f "tokens=1 delims=v." %%V in ('node --version') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto NODE_OLD
if %NODE_MAJOR% LSS 18 goto NODE_OLD
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if ($h.name -eq 'NIKOUS') { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 goto OPEN_BROWSER
start "NIKOUS" /min cmd.exe /d /c "set HOST=127.0.0.1&&set PORT=3000&&node server\index.js"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$end=(Get-Date).AddSeconds(20); while ((Get-Date) -lt $end) { try { $h=Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 1; if ($h.name -eq 'NIKOUS') { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1" >nul 2>&1
if errorlevel 1 goto START_FAILED
:OPEN_BROWSER
start "" "http://127.0.0.1:3000/"
exit /b 0
:NODE_MISSING
echo Node.js 18 ou plus recent est requis. Ouverture du site officiel.
start "" "https://nodejs.org/"
pause
exit /b 1
:NODE_OLD
echo Node.js 18 ou plus recent est requis. Installez la version LTS actuelle.
start "" "https://nodejs.org/"
pause
exit /b 1
:START_FAILED
echo NIKOUS ne repond pas sous 20 secondes.
echo Verifiez que le port 3000 est libre, puis reessayez.
pause
exit /b 1
