ARG NODE_VERSION=22.18.0

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN set -eux; \
    mkdir -p /opt/dashboard/static /opt/dashboard/server; \
    cp -R out/. /opt/dashboard/static/; \
    if [ -d server ]; then cp -R server/. /opt/dashboard/server/; fi

FROM node:${NODE_VERSION}-alpine AS runtime
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
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/agent-state-dashboard-entrypoint

RUN chmod 0555 /usr/local/bin/agent-state-dashboard-entrypoint \
    && mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp \
    && chown -R node:node /tmp/nginx /usr/share/nginx/html /app

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/agent-state-dashboard-entrypoint"]
