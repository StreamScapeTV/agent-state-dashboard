ARG NODE_VERSION=22.18.0

FROM node:${NODE_VERSION}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN set -eux; \
    test -f server/index.mjs; \
    mkdir -p /opt/dashboard/static /opt/dashboard/server; \
    cp -R out/. /opt/dashboard/static/; \
    cp -R server/. /opt/dashboard/server/

FROM node:${NODE_VERSION}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS runtime
RUN apk add --no-cache nginx tini

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SERVER_HOST=127.0.0.1 \
    SERVER_PORT=8788 \
    HOST=127.0.0.1 \
    PORT=8788

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /opt/dashboard/server/ /app/server/
COPY --from=build --chown=node:node /opt/dashboard/static/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/agent-state-dashboard-entrypoint

RUN chmod 0555 /usr/local/bin/agent-state-dashboard-entrypoint \
    && mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp \
    && chown -R node:node /tmp/nginx /usr/share/nginx/html /app

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -T 2 -O /dev/null http://127.0.0.1:8080/healthz || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/agent-state-dashboard-entrypoint"]
