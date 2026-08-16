#!/bin/sh
set -eu

: "${SUPABASE_URL:?SUPABASE_URL must be supplied by the Kubernetes Secret}"
: "${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY must be supplied by the Kubernetes Secret}"

case "${SUPABASE_URL}" in
  http://*|https://*) ;;
  *)
    echo "SUPABASE_URL must be an absolute HTTP(S) URL" >&2
    exit 64
    ;;
esac

SUPABASE_URL="${SUPABASE_URL%/}"
export SUPABASE_URL SUPABASE_SECRET_KEY

nginx_template="/etc/nginx/templates/nginx.conf.template"
nginx_config="/tmp/nginx.conf"

if [ ! -r "${nginx_template}" ]; then
  echo "NGINX configuration template is missing" >&2
  exit 70
fi
if ! command -v envsubst >/dev/null 2>&1; then
  echo "envsubst is unavailable in the runtime image" >&2
  exit 70
fi

# Kubernetes mounts an emptyDir over /tmp for the read-only root filesystem.
# Keep the rendered secret-bearing config private to the runtime UID and place
# every NGINX writable path below that ephemeral mount.
umask 077
mkdir -p \
  /tmp/nginx/client_temp \
  /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp \
  /tmp/nginx/uwsgi_temp \
  /tmp/nginx/scgi_temp

envsubst '${SUPABASE_URL} ${SUPABASE_SECRET_KEY}' < "${nginx_template}" > "${nginx_config}"
unset SUPABASE_URL SUPABASE_SECRET_KEY

exec nginx -c "${nginx_config}" -g 'daemon off;'
