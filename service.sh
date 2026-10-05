#!/bin/sh
# Runs Meridian as a macOS background service (launchd), so it starts at login and is started again if it stops.
#   ./service.sh install     write ~/Library/LaunchAgents/com.meridian.server.plist and start the service
#   ./service.sh uninstall   stop the service and remove the file
#   ./service.sh status      say whether it is installed and running
#   ./service.sh print       print the service file without installing anything
# The service runs the server directly, so build the app first (./start.sh does that once). Do not run ./start.sh
# while the service is installed: only one server can use the data folder and the port.
cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
LABEL="com.meridian.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA="${MERIDIAN_DATA:-$ROOT/data}"
PORT_NOW="${PORT:-4310}"
DOMAIN="gui/$(id -u)"

if [ -x "$ROOT/.tools/node/bin/node" ]; then NODE="$ROOT/.tools/node/bin/node"; else NODE="$(command -v node)"; fi

# Text as it must appear inside a plist string.
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# launchd gives a service a bare PATH. The bundled Node comes first, then the system folders.
service_path() {
  p="$(dirname "$NODE")"
  printf '%s' "$p:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
}

plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$(xml "$ROOT/server/main.ts")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml "$(service_path)")</string>
    <key>PORT</key>
    <string>$(xml "$PORT_NOW")</string>
    <key>MERIDIAN_DATA</key>
    <string>$(xml "$DATA")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(xml "$DATA/logs/service.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$DATA/logs/service.log")</string>
</dict>
</plist>
PLIST
}

need_node() {
  [ -n "$NODE" ] && [ -x "$NODE" ] || { echo "Node.js 24 or newer is required."; exit 1; }
  major="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
  [ "${major:-0}" -ge 24 ] || { echo "Node.js 24 or newer is required (found $("$NODE" -v 2>/dev/null))."; exit 1; }
}
loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

case "$1" in
  print)
    need_node
    plist
    ;;
  install)
    [ "$(uname)" = "Darwin" ] || { echo "The service is for macOS (launchd)."; exit 1; }
    need_node
    [ -f "$ROOT/app/dist/index.html" ] || { echo "The app has not been built yet. Run ./start.sh once, stop it, then install the service."; exit 1; }
    if curl -fsS -m 2 "http://127.0.0.1:$PORT_NOW/api/health" >/dev/null 2>&1 && ! loaded; then
      echo "Meridian is already running on port $PORT_NOW. Stop it (Ctrl+C where ./start.sh runs), then install the service."; exit 1
    fi
    mkdir -p "$HOME/Library/LaunchAgents" "$DATA/logs" || exit 1
    chmod 700 "$DATA" "$DATA/logs"
    if loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null; fi
    plist > "$PLIST.tmp" || exit 1
    plutil -lint "$PLIST.tmp" >/dev/null || { echo "The service file did not pass the check; nothing was installed."; rm -f "$PLIST.tmp"; exit 1; }
    mv "$PLIST.tmp" "$PLIST"
    launchctl bootstrap "$DOMAIN" "$PLIST" || { echo "launchd refused the service. The file is at $PLIST."; exit 1; }
    echo "Installed. Meridian now starts at login and is restarted if it stops: http://localhost:$PORT_NOW"
    echo "Service output: $DATA/logs/service.log   Server log: $DATA/logs/meridian.log"
    echo "Remove it with ./service.sh uninstall."
    ;;
  uninstall)
    if loaded; then launchctl bootout "$DOMAIN/$LABEL" && echo "Stopped the service."; fi
    if [ -f "$PLIST" ]; then rm -f "$PLIST" && echo "Removed $PLIST."; else echo "The service is not installed."; fi
    ;;
  status)
    if [ ! -f "$PLIST" ]; then echo "Not installed. Install it with ./service.sh install."; exit 0; fi
    if loaded; then
      pid="$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | sed -n 's/^[[:space:]]*pid = //p' | head -1)"
      if [ -n "$pid" ]; then echo "Installed and running (process $pid)."; else echo "Installed, not running right now. launchd starts it again within 10 seconds; if it keeps stopping, see $DATA/logs/service.log."; fi
    else
      echo "Installed but not loaded. Load it with ./service.sh install."
    fi
    ;;
  *)
    echo "Usage: ./service.sh install | uninstall | status | print"; exit 1
    ;;
esac
