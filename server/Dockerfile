# IntellMeet API image: Express + Socket.io + the in-process BullMQ worker.
#
# Built from the REPOSITORY ROOT, because the server depends on the `shared`
# workspace and the root lockfile:
#
#   docker build -f server/Dockerfile -t intellmeet-server .
#
# This is the file Render builds in production (render.yaml, Phase 12:
# `dockerfilePath: ./server/Dockerfile`, `dockerContext: .`), the image CI
# pushes to GHCR, and the image the Kubernetes manifests and Helm chart run.
#
# Plain Dockerfile syntax only (no BuildKit cache mounts or heredocs), so it
# builds the same on Render, GitHub Actions and a laptop.

ARG NODE_IMAGE=node:22-alpine

# ---- 1. deps: everything the build needs ------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Manifests only, so this layer is reused until a dependency changes. All three
# workspace manifests are copied because the lockfile describes all three; the
# install itself is limited to the two workspaces the API needs.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

# --ignore-scripts: no third-party install script runs while building the
# image. It is the same policy npm 12 applies on the development machine, so
# the image cannot quietly depend on a script that never runs locally. The only
# script on the server's runtime path is @ffmpeg-installer/linux-x64's
# `chmod u+x ffmpeg`, and its tarball already ships the binary as 0755; the
# runtime stage proves the binary executes.
RUN npm ci --ignore-scripts --no-audit --no-fund \
      --workspace @intellmeet/shared --workspace @intellmeet/server

# ---- 2. build: TypeScript -> dist -------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
RUN npm run build --workspace @intellmeet/shared \
 && npm run build --workspace @intellmeet/server

# ---- 3. prod-deps: runtime dependencies only --------------------------------
# A fresh install without devDependencies, rather than pruning stage 1, so no
# compiler, test runner or type package can leak into the final image.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --workspace @intellmeet/shared --workspace @intellmeet/server \
 && npm cache clean --force

# ---- 4. runtime --------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# PORT is only a default: Render injects its own, and the server reads it.
# RUN_WORKER_IN_PROCESS=true is how the free tier runs the AI queue (no
# background workers); the Kubernetes worker Deployment overrides it to false.
ENV NODE_ENV=production \
    PORT=5000 \
    RUN_WORKER_IN_PROCESS=true

WORKDIR /app

# node_modules keeps npm's workspace links (node_modules/@intellmeet/shared ->
# ../../shared), so `shared` is copied to the same relative place.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
# The sample meetings: read at run time by the seed and by the weekly demo
# history refresh (modules/demo/demo.meetings.ts).
COPY server/fixtures ./server/fixtures

# The only place the app writes on disk: recordings when Cloudinary is not
# configured (RECORDINGS_DIR). ffmpeg's scratch files go to /tmp. Everything
# else stays owned by root, so the process cannot modify its own code.
# The last line fails the build if the bundled ffmpeg cannot run on this base
# image - it splits long recordings before transcription.
RUN mkdir -p server/.data/recordings \
 && chown -R node:node server/.data \
 && "$(node -p "require('@ffmpeg-installer/ffmpeg').path")" -hide_banner -version | head -n 1

# The official image's unprivileged user (uid 1000).
USER node
WORKDIR /app/server
EXPOSE 5000

# Liveness: /api/health answers 200 whenever the process can serve (it reports
# Mongo and Redis in the body rather than failing on them). Render uses its own
# healthCheckPath and Kubernetes its probes; this serves `docker run` and
# docker compose. fetch() is built into Node, so no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Node is PID 1 and handles SIGTERM itself (graceful shutdown in server.ts).
# Exec form, so the signal reaches Node rather than a shell.
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.js"]
