ARG NODE_VERSION=22.18.0
ARG NGINX_VERSION=1.29.8

FROM docker.io/library/node:${NODE_VERSION}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN set -eux; \
    test -f out/index.html; \
    test -d out/_next/static

FROM docker.io/library/nginx:${NGINX_VERSION}-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime

COPY --from=build /workspace/out/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/templates/nginx.conf.template
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/entrypoint.sh /usr/local/bin/agent-state-dashboard-entrypoint

RUN set -eux; \
    rm -f /etc/nginx/conf.d/default.conf; \
    chmod 0555 /usr/local/bin/agent-state-dashboard-entrypoint; \
    chmod -R a+rX /usr/share/nginx/html /etc/nginx/templates /etc/nginx/security-headers.conf; \
    command -v envsubst; \
    mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp; \
    SUPABASE_URL=https://localhost SUPABASE_SECRET_KEY=sb_secret_build_check \
      envsubst '${SUPABASE_URL} ${SUPABASE_SECRET_KEY}' \
      < /etc/nginx/templates/nginx.conf.template \
      > /tmp/nginx-build-check.conf; \
    grep -Fq 'listen 8443 ssl;' /tmp/nginx-build-check.conf; \
    grep -Fq 'ssl_certificate /tls/tls.crt;' /tmp/nginx-build-check.conf; \
    grep -Fq 'ssl_certificate_key /tls/tls.key;' /tmp/nginx-build-check.conf; \
    rm -f /tmp/nginx-build-check.conf

USER 101
EXPOSE 8443
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --no-check-certificate -T 2 -O /dev/null https://127.0.0.1:8443/healthz || exit 1
STOPSIGNAL SIGQUIT
ENTRYPOINT ["/usr/local/bin/agent-state-dashboard-entrypoint"]
