#!/bin/sh
# Personal local mode; reuses your own Codex ChatGPT login. Does not expose the dashboard publicly.
cd "$(dirname "$0")" || exit 1
MERIDIAN_ENGINE=codex-local
export MERIDIAN_ENGINE
exec ./start.sh
