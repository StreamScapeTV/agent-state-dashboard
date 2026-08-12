#!/bin/sh
set -eu

: "${SUPABASE_URL:?SUPABASE_URL must be supplied by the Kubernetes Secret}"
: "${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY must be supplied by the Kubernetes Secret}"

SERVER_ENTRYPOINT="${SERVER_ENTRYPOINT:-/app/server/index.mjs}"
SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${SERVER_PORT:-8788}"

if [ ! -f "${SERVER_ENTRYPOINT}" ]; then
  echo "dashboard server entrypoint is missing: ${SERVER_ENTRYPOINT}" >&2
  exit 70
fi

export SERVER_HOST SERVER_PORT
export HOST="${HOST:-${SERVER_HOST}}"
export PORT="${PORT:-${SERVER_PORT}}"

node "${SERVER_ENTRYPOINT}" &
server_pid=$!
nginx -g 'daemon off;' &
nginx_pid=$!

terminate() {
  trap - HUP INT TERM
  kill -TERM "${server_pid}" "${nginx_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
  wait "${nginx_pid}" 2>/dev/null || true
  exit 143
}

trap terminate HUP INT TERM

while kill -0 "${server_pid}" 2>/dev/null && kill -0 "${nginx_pid}" 2>/dev/null; do
  sleep 1
done

status=0
if ! kill -0 "${server_pid}" 2>/dev/null; then
  if wait "${server_pid}"; then status=0; else status=$?; fi
  kill -TERM "${nginx_pid}" 2>/dev/null || true
  wait "${nginx_pid}" 2>/dev/null || true
else
  if wait "${nginx_pid}"; then status=0; else status=$?; fi
  kill -TERM "${server_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
fi

exit "${status}"
