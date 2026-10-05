#!/bin/sh
# Backup and restore of Meridian's data folder, without the server.
#   ./backup.sh                  make a backup now (data/backups/meridian-YYYYMMDD-HHMMSS.zip); safe while Meridian runs
#   ./backup.sh list             list the backups
#   ./backup.sh restore <zip>    replace data/ with a backup. Stop Meridian first: it is refused while the server runs.
#                                The current data is kept next to it as data.before-restore-<time>.
# A backup holds password hashes and the encryption key (secret.key): keep copies somewhere only you can reach.
cd "$(dirname "$0")" || exit 1
if [ -x "./.tools/node/bin/node" ]; then PATH="$PWD/.tools/node/bin:$PATH"; export PATH; fi
command -v node >/dev/null || { echo "Node.js 24 or newer is required."; exit 1; }
# A backup named by a path relative to where the command was typed still has to be found after the cd above.
if [ "$1" = "restore" ] && [ -n "$2" ]; then
  case "$2" in
    /*) file="$2" ;;
    *) if [ -f "$OLDPWD/$2" ]; then file="$OLDPWD/$2"; else file="$2"; fi ;;
  esac
  exec node --disable-warning=ExperimentalWarning server/backup.ts restore "$file"
fi
exec node --disable-warning=ExperimentalWarning server/backup.ts "$@"
