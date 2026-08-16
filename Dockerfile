ARG NODE_VERSION=22.18.0
ARG NGINX_VERSION=1.29.8

FROM node:${NODE_VERSION}-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN set -eux; \
    test -f out/index.html; \
    test -d out/_next/static

FROM nginx:${NGINX_VERSION}-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime

COPY --from=build /workspace/out/ /usr/share/nginx/html/
COPY docker/nginx.conf /etc/nginx/templates/nginx.conf.template
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/entrypoint.sh /usr/local/bin/agent-state-dashboard-entrypoint

RUN rm -f /etc/nginx/conf.d/default.conf \
    && chmod 0555 /usr/local/bin/agent-state-dashboard-entrypoint \
    && chmod -R a+rX /usr/share/nginx/html /etc/nginx/templates /etc/nginx/security-headers.conf

USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -T 2 -O /dev/null http://127.0.0.1:8080/healthz || exit 1
STOPSIGNAL SIGQUIT
ENTRYPOINT ["/usr/local/bin/agent-state-dashboard-entrypoint"]
