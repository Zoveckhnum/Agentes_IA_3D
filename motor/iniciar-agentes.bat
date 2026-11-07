@echo off
title Motor de agentes - Stackbi Office
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm.cmd install --silent
)
:loop
node worker.mjs
echo.
echo El motor se detuvo. Se reinicia en 15 segundos (cierra esta ventana para apagarlo)...
timeout /t 15 /nobreak >nul
goto loop
