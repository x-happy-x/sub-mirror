#!/bin/sh
set -e

SUBCONVERTER_BIN="${SUBCONVERTER_BIN:-subconverter}"
SUBCONVERTER_PORT="${SUBCONVERTER_PORT:-8787}"
APP_PORT="${APP_PORT:-8788}"

if ! command -v "$SUBCONVERTER_BIN" >/dev/null 2>&1; then
  if [ -x /subconverter/subconverter ]; then
    SUBCONVERTER_BIN=/subconverter/subconverter
  elif [ -x /base/subconverter ]; then
    SUBCONVERTER_BIN=/base/subconverter
  elif [ -x /usr/local/bin/subconverter ]; then
    SUBCONVERTER_BIN=/usr/local/bin/subconverter
  fi
fi

if ! command -v "$SUBCONVERTER_BIN" >/dev/null 2>&1; then
  echo "subconverter binary not found" >&2
  exit 1
fi

if [ -f /base/pref.toml ]; then
  sed -i "s/^listen = .*/listen = \"0.0.0.0\"/" /base/pref.toml
  sed -i "s/^port = .*/port = ${SUBCONVERTER_PORT}/" /base/pref.toml
fi

(cd /base && PORT="$SUBCONVERTER_PORT" "$SUBCONVERTER_BIN") &

PORT="$APP_PORT" exec node /app/server.js
