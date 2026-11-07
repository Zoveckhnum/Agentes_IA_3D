#!/usr/bin/env bash
# Motor de agentes - Stackbi Office (macOS / Linux). Ctrl + C para apagarlo.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Instalando dependencias por primera vez..."
  npm install --silent
fi
while true; do
  node worker.mjs
  echo
  echo "El motor se detuvo. Se reinicia en 15 segundos (Ctrl + C para apagarlo)..."
  sleep 15
done
