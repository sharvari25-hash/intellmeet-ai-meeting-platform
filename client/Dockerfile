# IntellMeet web client image: the Vite build served by nginx.
#
# Production serves the client from Vercel; this image is for the Kubernetes
# path and for running the whole stack locally (docker-compose.prod.yml).
# Built from the REPOSITORY ROOT, like the server image:
#
#   docker build -f client/Dockerfile -t intellmeet-client .
#
# nginx also proxies /api and /socket.io to the API (API_UPSTREAM), so the
# browser sees one origin, exactly as it does behind the Vercel rewrite.

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:stable-alpine

# ---- 1. build ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# Same install-script policy as the server image. Vite, Rollup, Tailwind and
# LightningCSS take their native binaries from per-platform packages in the
# lockfile, not from install scripts.
RUN npm ci --ignore-scripts --no-audit --no-fund \
      --workspace @intellmeet/shared --workspace @intellmeet/client

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY client/ client/

# VITE_ variables are inlined into the bundle at build time, so they are build
# arguments, never secrets. Left empty, the socket connects to the page's own
# origin, which is what the nginx proxy below and the Kubernetes Ingress
# provide. (client/.env is excluded by .dockerignore, so a developer's
# localhost URL cannot end up in the image.)
ARG VITE_SOCKET_URL=
ARG VITE_SENTRY_DSN=
ENV VITE_SOCKET_URL=${VITE_SOCKET_URL} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN}

RUN npm run build --workspace @intellmeet/shared \
 && npm run build --workspace @intellmeet/client

# ---- 2. runtime: static files + reverse proxy ------------------------------
# The unprivileged nginx variant runs as uid 101 and listens on 8080, so the
# container needs no root and no NET_BIND_SERVICE capability.
FROM ${NGINX_IMAGE} AS runtime

# Rendered by the image's entrypoint (envsubst) into conf.d/default.conf at
# start-up, substituting only variables that are set, so nginx's own $uri,
# $host, ... are left alone.
COPY client/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/client/dist /usr/share/nginx/html

# Where /api and /socket.io are forwarded: the compose service name by
# default; the Kubernetes Service name in the chart. The filter limits the
# template substitution to this one variable.
ENV API_UPSTREAM=http://server:5000 \
    NGINX_ENVSUBST_FILTER=^API_UPSTREAM$

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
