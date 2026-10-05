#!/bin/sh
# Builds the app if needed, then starts Meridian on http://localhost:4310 (change with PORT=...).
cd "$(dirname "$0")" || exit 1
if [ -x "./.tools/node/bin/node" ]; then PATH="$PWD/.tools/node/bin:$PATH"; export PATH; fi
command -v node >/dev/null || { echo "Node.js 24 or newer is required, and no 'node' was found. Install it from https://nodejs.org, then run ./start.sh again."; exit 1; }
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 24 ]; then echo "Meridian needs Node.js 24 or newer; this computer has $(node --version 2>/dev/null). Install a newer one from https://nodejs.org, then run ./start.sh again."; exit 1; fi
if [ ! -d app/node_modules ]; then echo "Installing packages..."; (cd app && npm install) || exit 1; fi
if [ ! -f app/dist/index.html ] || [ -n "$(find app/src app/index.html -newer app/dist/index.html -print -quit 2>/dev/null)" ]; then
  echo "Building the app..."; (cd app && npm run build) || exit 1
fi
exec node --disable-warning=ExperimentalWarning server/main.ts
