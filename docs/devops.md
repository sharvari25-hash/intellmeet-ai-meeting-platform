# Containers, CI/CD and deployment (Phases 11 and 12)

How the code becomes images, how every change is checked, how the images
reach a registry, and how a merge reaches production. **Production runs on
Vercel (client) and Render (API, built from `server/Dockerfile`)**; the
operational detail (services, variables, rotation, troubleshooting) is in
[`deployment.md`](./deployment.md). The Kubernetes path is in
[`kubernetes.md`](./kubernetes.md).

## The two images

Both Dockerfiles build from the **repository root** (`docker build -f
server/Dockerfile .`), because each depends on the `shared` workspace and the
root lockfile.

### `server/Dockerfile` (the API; what Render builds)

```
deps       node:22-alpine  npm ci (shared + server workspaces, all deps, --ignore-scripts)
build      = deps + source tsc: shared -> shared/dist, server -> server/dist
prod-deps  node:22-alpine  npm ci --omit=dev (fresh: no compiler or test runner can leak)
runtime    node:22-alpine  node_modules + dist + server/fixtures, USER node, HEALTHCHECK
```

| Decision | Why |
| --- | --- |
| **Node 22 on Alpine** | The plan's Node version (`.nvmrc`), the smallest official base. Nothing native needs glibc: bcryptjs is pure JavaScript (chosen in Phase 2 for exactly this), and the MongoDB and Redis clients are JavaScript. |
| **`npm ci --ignore-scripts`** | No third-party install script runs while building. It is the same policy npm 12 applies on the development machine, so the image cannot depend on a script that never runs locally. The one install script on the runtime path is `@ffmpeg-installer/linux-x64`'s `chmod u+x ffmpeg`, and its tarball already ships the binary as `0755` (checked). |
| **The build fails if ffmpeg cannot run** | `RUN "$(node -p "require('@ffmpeg-installer/ffmpeg').path")" -version` in the runtime stage. The package's Linux binary is a static build, so it runs on musl; it prints `ffmpeg version N-47683-g0e8eb07980-static`. |
| **A fresh production install, not `npm prune`** | Nothing from the build stage reaches the runtime image except `dist/`. Checked: no TypeScript, Vitest, tsx or mongodb-memory-server in the image. |
| **Workspace links kept** | `node_modules/@intellmeet/shared` is npm's link to `../../shared`, so `shared/package.json` and `shared/dist` are copied to that same place. |
| **`server/fixtures` copied** | The seed and the weekly demo-history refresh read the sample meetings at run time. |
| **Non-root, code owned by root** | Runs as the image's `node` user (uid 1000). Only `server/.data` (local recordings) is writable; the process cannot modify its own code. Works with a read-only root filesystem (tested with `docker run --read-only --tmpfs /tmp --cap-drop ALL`). |
| **`RUN_WORKER_IN_PROCESS=true`** | Render's free tier has no background workers, so the web process consumes the AI queue. Kubernetes can override it (the chart's `worker.enabled`). |
| **HEALTHCHECK with `fetch`** | `/api/health` on `$PORT` (Render injects its own port). Node 22 has `fetch`, so no curl in the image. Render ignores Docker health checks and uses its own `healthCheckPath`; this one serves `docker run` and Compose. |
| **Node is PID 1, exec-form CMD** | SIGTERM reaches Node directly and `server.ts` shuts down gracefully. ffmpeg children are awaited by Node, so nothing is left to reap. |
| **Plain Dockerfile syntax** | No BuildKit cache mounts or heredocs, so it builds identically on Render, GitHub Actions and a laptop. |

### `client/Dockerfile` (the web client, for Compose and Kubernetes)

The Vite build, served by `nginxinc/nginx-unprivileged` (uid 101, port 8080).
nginx serves the single-page app with an `index.html` fallback, gives hashed
assets a one-year cache and the app shell `no-cache`, and **proxies `/api` and
`/socket.io` to the API** (`API_UPSTREAM`), including the WebSocket upgrade.
The browser therefore sees one origin, as it does behind the Vercel rewrite.

- `VITE_*` values are build arguments (they are public and inlined into the
  bundle). Left empty, the socket connects to the page's own origin.
  `client/.env` is excluded by `.dockerignore`, so a developer's
  `localhost:5000` can never be baked into an image (checked in the bundle).
- The config is a template rendered at start-up, restricted to `API_UPSTREAM`
  (`NGINX_ENVSUBST_FILTER`), so nginx's own `$uri`/`$host` are never touched.

### `.dockerignore`

Every `.env` (except `.env.example`), keys, `node_modules`, build output,
coverage, recordings, docs, tests and infrastructure files. `server/.env`
holds real keys; it must never be in a build context, where a `COPY` could
put it in a layer anyone who pulls the image can read.

## `docker-compose.prod.yml`: the whole stack from the images

```powershell
docker compose --env-file server/.env -f docker-compose.prod.yml up -d --build
docker compose --env-file server/.env -f docker-compose.prod.yml run --rm server node dist/scripts/seed.js
start http://localhost:8080      # Try Live Demo
docker compose -f docker-compose.prod.yml down -v
```

MongoDB, Redis (with `noeviction`, since BullMQ keeps jobs there), the API and
nginx. Only the client's port is published, and it is its own Compose project
(`intellmeet-prod`), so it runs next to `npm run dev` without a clash.
`--env-file server/.env` only fills in `${JWT_SECRET}` and the optional AI
settings; `CLIENT_PORT` changes the port.

## CI/CD

| Workflow | Runs on | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | every pull request, every push to `main`, manual | **checks**: install (npm cache) → build shared → lint → Prettier → typecheck → server tests with coverage → client tests with coverage → production build → coverage table in the job summary + reports as an artifact. **e2e** (in parallel): the Playwright suite. |
| `.github/workflows/docker.yml` | push to `main` (build + push); PRs that touch an image's inputs (build only) | Both images, pushed to `ghcr.io/sharvari25-hash/intellmeet-server` and `-client` as `latest` and `sha-<commit>`, with the build cache in GitHub's cache service. |

### Why the e2e suite runs in CI

**Decision: yes, on every pull request and every push to main, as its own job
in parallel with the checks.**

- It is the only thing that exercises what this product *is*: two browsers
  negotiating a WebRTC mesh, live board sync over Socket.io, recording through
  the real BullMQ queue, the analytics pipeline over seeded data. The unit
  suites stub all of those seams. A regression there (like the Phase 5 stall
  that one join in six hit) would otherwise only be found by hand.
- What it needs is cheap on GitHub's runners: MongoDB and Redis as service
  containers, a seed, a JWT secret generated for the run, and no accounts or
  repository secrets (the AI provider is the mock).
- **Shaped for a 2-CPU runner** (a private repository's size), after a
  rehearsal (below) where the first design failed: two browsers encoding
  fake camera video, the API, the web server, MongoDB and Redis all share
  those 2 CPUs. So CI runs the suite against the **production build**
  (`E2E_SERVE=build`: `node dist/server.js` and `vite preview`, instead of
  `tsx watch` and the Vite dev server, which serves hundreds of unbundled
  modules to every new browser context) in Playwright's lighter **headless
  shell** (`E2E_CHANNEL=bundled`; the runner has no Chrome, the laptop keeps
  `channel: 'chrome'`), with the per-test and per-assertion ceilings doubled
  (120 s / 30 s). The specs' own tight budgets, such as a peer connection
  within 4.5 s, are unchanged.
- **Cost**: about 6 minutes of Playwright plus install and build, about 15
  minutes of runner time per push. The repository is private, so it counts
  against the free plan's 2,000 minutes a month; a newer push to the same PR
  cancels the older run, and the two jobs run side by side so the wall-clock
  time is that of the slower one (the checks job, about 30 minutes on 2
  CPUs).
- **Flakiness policy**: one retry in CI only. A test that passes only on its
  retry is reported as *flaky* in the summary and the HTML report (uploaded
  as an artifact with the trace of the failed attempt), so it is visible, not
  hidden.
- **Escape hatch** if minutes run short: change the job's `if:` to run only on
  `push` to main, or on a `run-e2e` label. The decision is easy to reverse
  because the job stands alone.

### Rehearsed before the first push

The workflows could not run on GitHub before the PR exists, so both jobs
were replayed locally, step for step, in the environment the runner provides:
Ubuntu 24.04 (Playwright's `v1.63.0-noble` image, with Node 22 from the
official image as `setup-node` installs it), limited to **2 CPUs and 7 GB**
(a private repository's runner), with MongoDB and Redis as sibling containers
named like the service containers, from a copy of exactly the files a
checkout contains. `actionlint` checked both workflow files (0 findings).

| Step (2 CPUs) | Result | Time |
| --- | --- | --- |
| `npm ci --ignore-scripts` (cold cache) | ✅ | 5.5 min |
| lint, Prettier, typecheck | ✅ | 6.5 min |
| server tests + coverage (mongod downloaded on Ubuntu 24.04) | ✅ 494/494, 94.5 / 85.0 / 95.2 / 94.5 % | 9 min |
| client tests + coverage | ✅ 188/188, 75.5 / 82.7 / 73.5 / 75.5 % | 4 min |
| production build | ✅ | 4 min |
| coverage table (`.github/scripts/coverage-summary.mjs`) | ✅ | - |
| **e2e, first design** (dev servers, full Chromium) | ❌ 5 passed, 2 failed, 1 flaky: the camera took over 15 s to start in the two-browser specs | 15.7 min |
| **e2e, final design** (production build, headless shell) | ✅ 6 passed, 2 flaky (passed on retry), 0 failed | 6.0 min |
| history spec alone, 3 runs, fresh database, no retries | ✅ 3/3 | 2.5 min |

What the rehearsal changed: the e2e job's design (above), the checks job's
time limit (25 → 45 minutes), and the test ceilings (below).

The two flaky tests in the final design: the mesh spec missed its deliberate
4.5 s connection budget once on 2 CPUs, and the history search's highlighted
`<mark>` did not appear once mid-suite. The history spec then passed three
runs out of three on a fresh database, so it is not a first-run bug; its
trace will be in the CI artifact if it recurs.

**Test ceilings.** Under coverage, some client page tests take 3-4 s on an
idle laptop, against Vitest's 5 s limit and Testing Library's 1 s wait for an
element, and they timed out when the machine was busy. `testTimeout` is now
15 s (client and server) and Testing Library's `asyncUtilTimeout` 5 s. These
are ceilings, not delays: a passing test is exactly as fast as before; only a
genuine failure takes longer to report. The server's coverage is now gated
at 90 / 80 / 90 / 90 % (statements / branches / functions / lines).

### GitHub settings

Nothing is required: no repository secrets, and the workflows use the
built-in `GITHUB_TOKEN` (`packages: write` is requested by `docker.yml`
itself). Worth checking once:

1. **Settings → Actions → General → Actions permissions**: "Allow all actions
   and reusable workflows" (the default). The workflows use `actions/*` and
   `docker/*`.
2. **After the first push to main**, the two packages appear under your
   profile's *Packages*, private (like the repository). Make them public in
   *Package settings* only if a cluster should pull them without a secret.
   Render does not pull them; it builds `server/Dockerfile` itself.
3. **Branch protection** (requiring CI to pass before merging) needs GitHub
   Pro or a public repository; on a private repository on the free plan the
   checks still run and show on every PR, they just cannot block the merge
   button.

### Checking that CI is green on a pull request

1. Push the branch and open the PR against `main`.
2. The PR page lists the checks at the bottom: **CI / Lint, typecheck, unit
   tests, build**, **CI / End-to-end (Playwright)**, **Docker / server image**
   and **Docker / client image** (the Docker two only when the PR touches
   what goes into an image, which the Phase 11 PR does). Green ticks on all
   of them = green. Expect about 30 minutes for the slowest.
3. If the e2e job shows *flaky* tests, it is still green: they passed on the
   retry. Open the `playwright-report` artifact to see the failed attempt's
   trace.
4. **Details** on a check opens its log. The run page (the **Actions** tab)
   has the coverage table in its summary, and the `coverage` and
   `playwright-report` artifacts to download.
5. The badges at the top of the README show the latest run on `main`.

Since Phase 12, Vercel also reports its own deployment on each commit (a
preview for a PR branch, production for `main`).

## Continuous deployment (Phase 12)

```
PR ── CI checks, e2e, image builds ──► merge to main
                                          │
          ┌───────────────────────────────┴──────────────────────────────┐
          ▼                                                              ▼
Vercel: builds main at once             Render: waits until every check on the commit
(client/vercel.json), production        has passed (autoDeployTrigger: checksPass), then
in about a minute                       builds server/Dockerfile, if the commit touched
                                        what goes into the image (buildFilter); live once
                                        /api/health answers
```

### `render.yaml`: the Render Blueprint

| Decision | Why |
| --- | --- |
| **One Blueprint for the API and its Redis** | Both services, their region, plans and every non-secret setting are in the repository and reviewed like code. The Blueprint was created from `main` and follows it: a change to `render.yaml` on `main` is applied on the next sync. |
| **`runtime: docker`, `dockerContext: .`** | Render builds the same `server/Dockerfile` CI builds and Kubernetes runs, from the repository root (the server needs `shared/` and the root lockfile). Render does not pull the GHCR image. |
| **`autoDeployTrigger: checksPass`** | A commit is deployed only once all of its GitHub checks have passed, so a red CI run never reaches production. (A commit with no checks at all is never auto-deployed.) Manual deploys still work. |
| **`buildFilter`** | Only `server/**`, `shared/**`, the root `package.json` and lockfile, `tsconfig.base.json` and `.dockerignore` trigger a build: a docs-only or client-only merge does not restart the API or spend build minutes. |
| **`healthCheckPath: /api/health`** | 200 whenever the process can answer, with MongoDB and Redis reported in the body. Restarting the API does not fix a database outage, so it does not fail on one. |
| **Secrets `sync: false`, `JWT_SECRET` generated** | Render asks for each secret once, when the Blueprint is created, and never reads it from the file; later syncs leave them alone. `JWT_SECRET` is generated by Render and never seen by anyone. |
| **`REDIS_URL` from the Key Value (`fromService`)** | The private-network URL is wired by Render; nobody types it. |
| **Key Value: `noeviction`, `ipAllowList: []`** | BullMQ needs `noeviction` (a full instance refuses writes rather than silently evicting a queued job); no allow-list entries means no public endpoint. |
| **`NODE_OPTIONS=--max-old-space-size=384`, `BCRYPT_COST=10`** | Sized for the free plan's 512 MB and 0.1 CPU (measured: the image took 53 s to become healthy at 0.1 CPU; cost 12 took 5-7 s per sign-in). |

The file was checked against Render's published Blueprint JSON schema.

### `client/vercel.json`

| Setting | Why |
| --- | --- |
| **`installCommand` / `buildCommand` with `cd ..`** | The project's Root Directory is `client`, but the client depends on the `shared` workspace. Both commands run from the repository root: install only the two workspaces (`--ignore-scripts`, as everywhere), build `shared`, then the client. Requires "Include files outside the root directory in the Build Step". |
| **Rewrite `/api/:path*` → the Render service** | The browser sees the API as same-origin, so the refresh cookie is first-party and there is no API base URL. Vercel proxies the request and overwrites `X-Forwarded-For` with the visitor's address. |
| **SPA fallback `/((?!api/\|assets/\|robots\.txt$\|favicon\.svg$).*)` → `/index.html`** | Deep links such as `/app/meetings/…` load the app. Real files are served before rewrites anyway; the exclusions make a *missing* asset a 404 rather than `index.html` served as JavaScript (which would break a stale tab with a confusing error). |
| **Headers** | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a `Permissions-Policy` allowing camera, microphone and screen capture for this site only; hashed assets `public, max-age=31536000, immutable`. Vercel adds HSTS. |

Checked before and after going live: Vercel's own route converter on the
file, and on the live site the rewrite, a deep link, `robots.txt` as
`text/plain`, a missing chunk as 404, the cache and security headers, the
refresh cookie's flags through the rewrite, and `VITE_SOCKET_URL` present in
exactly one lazy chunk with no `localhost` anywhere in the bundle.
