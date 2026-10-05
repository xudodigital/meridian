#!/bin/sh
# Development: the API on http://localhost:4310 and the app with hot reload on http://localhost:5173.
cd "$(dirname "$0")" || exit 1
if [ -x "./.tools/node/bin/node" ]; then PATH="$PWD/.tools/node/bin:$PATH"; export PATH; fi
[ -d app/node_modules ] || (cd app && npm install) || exit 1
node --disable-warning=ExperimentalWarning server/main.ts &
API=$!
trap 'kill $API 2>/dev/null' EXIT INT TERM
cd app && npm run dev
