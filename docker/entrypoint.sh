#!/bin/sh
set -eu

: "${SUPABASE_URL:?SUPABASE_URL must be supplied by the Kubernetes Secret}"
: "${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY must be supplied by the Kubernetes Secret}"

# TLS is mandatory. Flux/cert-manager owns the Secret and mounts these stable
# paths through the producer chart; there is intentionally no plaintext mode.
tls_cert="/tls/tls.crt"
tls_key="/tls/tls.key"
if [ ! -r "${tls_cert}" ] || [ ! -s "${tls_cert}" ]; then
  echo "TLS certificate must be mounted at ${tls_cert}" >&2
  exit 64
fi
if [ ! -r "${tls_key}" ] || [ ! -s "${tls_key}" ]; then
  echo "TLS private key must be mounted at ${tls_key}" >&2
  exit 64
fi

# The values are substituted into an NGINX configuration, so validate their
# complete grammar rather than attempting to escape arbitrary configuration
# syntax. Hosted Supabase URLs are origins; local/self-hosted development may
# additionally use an explicit port. Both current sb_secret_* and legacy
# service_role JWT keys fit the bounded API-key character set below.
if ! printf '%s\n' "${SUPABASE_URL}" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$'; then
  echo "SUPABASE_URL must be an HTTP(S) origin without a path, query, fragment, or credentials" >&2
  exit 64
fi
if ! printf '%s\n' "${SUPABASE_SECRET_KEY}" | grep -Eq '^[A-Za-z0-9._-]+$'; then
  echo "SUPABASE_SECRET_KEY has an unsupported format" >&2
  exit 64
fi

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

# Validate the rendered configuration against the actual mounted certificate
# and private key. This also rejects malformed or mismatched TLS material.
if ! nginx -t -c "${nginx_config}"; then
  echo "NGINX configuration or mounted TLS material is invalid" >&2
  exit 70
fi

exec nginx -c "${nginx_config}" -g 'daemon off;'
