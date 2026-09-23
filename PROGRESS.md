# IntellMeet — Build Progress Log

Running record of what was built, why it was built that way, what is known to
be missing, and what comes next. Updated at the end of every phase.

---

## Phase 1 — Backend Foundation ✅

**Completed:** 2026-09-23

### Built

- **Middleware pipeline** in `app.ts`, in the exact order the plan specifies:
  requestId → pino-http → helmet → CORS allowlist → `json({ limit: '1mb' })` →
  cookie-parser → mongo-sanitize → HPP → routes → 404 → central error handler.
- **`AppError`** with ten typed error codes, each mapped to one HTTP status in
  a single table, plus static factories (`AppError.notFound()`, …).
- **Central error handler** producing the shared
  `{ error: { code, message, details?, requestId } }` shape for *every* failure,
  translating zod errors, body-parser errors and Mongo duplicate-key errors.
- **MongoDB connection** with exponential-backoff retry + jitter, connection
  event logging and a real `ping` health probe.
- **Redis connection** (ioredis) with a bounded retry strategy, automatic TLS
  for `rediss://`, `maxRetriesPerRequest: null` for BullMQ, and a timed ping.
- **Graceful shutdown**: SIGTERM/SIGINT/uncaughtException/unhandledRejection →
  stop accepting connections → drain → force-close sockets after a timeout →
  close Mongo and Redis → exit.
- **`validate(schema)`** middleware: checks body/query/params in one pass,
  reports every problem at once, and writes the coerced value back.
- **Health endpoints**: `GET /api/health` (liveness, always 200, reports
  per-dependency status) and `GET /api/health/ready` (readiness, 503 when a
  dependency is down).
- **Structured logging** (pino + pino-http) with secret redaction, correlation
  ids, pretty output in dev and JSON in production.
- **Test infra**: Vitest + Supertest + `mongodb-memory-server`, with a shared
  in-memory MongoDB per run and a stub Redis client.
- `docker-compose.yml` now sets `name: intellmeet` so the Compose project is
  not named after the containing folder.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Wrote our own `mongoSanitize` and `preventParameterPollution` instead of using `express-mongo-sanitize` and `hpp`** | Both libraries do `req.query = <new object>`, and Express 5 defines `query` as a **getter-only** property — verified directly: the assignment throws `Cannot set property query of #<IncomingMessage> which has only a getter`. The property *is* `configurable`, so the replacements use `Object.defineProperty` on the request instance. The plan allows "express-mongo-sanitize **or equivalent**". |
| Sanitizer rejects `$`/`.` **anywhere** in a key, not just as a prefix | Express 5's default `simple` query parser does not build nested objects, so `?role[$ne]=member` arrives as the single flat key `role[$ne]`. A "starts with `$`" check waves it straight through. |
| `/api/health` returns **200 even when degraded**; `/api/health/ready` returns 503 | Render restarts a service whose health check fails. Restarting the API does nothing to fix a MongoDB outage — it converts a partial outage into a total one. Readiness is the endpoint that should shed traffic, and it is what the Kubernetes readiness probe (Phase 11) will use. |
| `dotenv` loads `.env` by a path relative to the module, not `process.cwd()` | `import 'dotenv/config'` resolves against the working directory, so `node dist/server.js` from the repo root silently found no config. Caught during verification. Real env vars still win, so Docker/Render/CI are unaffected. |
| Health probes are timed out (2s) and always resolve | `maxRetriesPerRequest: null` (required by BullMQ) means a Redis command issued during an outage queues **forever** instead of rejecting. Without the timeout, one dead dependency would hang the health endpoint, and with it Render's health check. |
| Redis is a module singleton with a `setRedisClient` seam | Lets the suite inject a stub that answers `PING`, so tests need no live Redis and CI needs no Redis service. The single `as unknown as Redis` cast is confined to the test setup file. |
| Tests use `mongodb-memory-server`, not the Docker container | Real MongoDB semantics (indexes, aggregation, duplicate-key errors) with per-run data that disappears afterwards, and no shared state between the suite and local development. |
| Correlation id validated before being reused from `X-Request-Id` | An unvalidated inbound header lands directly in log lines — a log-injection/forging vector. |
| `errorHandler` hides 5xx messages in production only | Internal messages leak stack frames and connection strings; development keeps the real text to stay debuggable. |
| Split `tsconfig.json` (typecheck) and `tsconfig.build.json` (build) | `typecheck` must cover tests and `vitest.config.ts`; `dist/` must not contain them. |
| `requestId` runs before `httpLogger` | So every log line, including for requests helmet or CORS rejects, carries the same id the client sees in the error body. |

### Known limitations

- **Graceful shutdown was verified by emitting SIGTERM in-process**, because
  Windows cannot deliver a real SIGTERM to another process (`process.kill`
  terminates it outright). The handler chain exercised is identical; real
  signal delivery gets confirmed on Render/Docker in Phase 12.
- No authentication, rate limiting or CSRF protection yet — Phase 2.
- The Socket.io server and its Redis adapter are not wired in yet, so the
  shutdown path has no socket step to close — Phase 3.
- `mongoSanitize` strips *any* key containing `$` or `.`. No current or planned
  field needs those characters, but a future free-form metadata field would.
- Redis has no live integration test; it is covered by unit tests plus manual
  verification against the Docker container (see below).
- `npm install` warns that `esbuild` and `mongodb-memory-server` postinstall
  scripts were blocked by npm 12's `allowScripts` policy. Harmless: esbuild's
  prebuilt binary is present, and `mongodb-memory-server` downloads its mongod
  binary on first use instead (hence the generous `launchTimeout`).

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **46 passed** (43 server, 3 client) |
| `npm run test:coverage -w @intellmeet/server` | ✅ **86.7%** statements / 82.6% branches (Phase 10 target is 50%) |
| `npm run build` | ✅ all 3 workspaces; `dist/` contains no test files |

### Manual verification performed

Against the real Docker MongoDB and Redis:

```
GET  /api/health          → 200 status:"ok", mongo up (6ms), redis up (3ms)
GET  /api/health/ready    → 200
GET  /api/nope            → 404 { error: { code:"NOT_FOUND", message, requestId } }
GET  /api/health          → echoes X-Request-Id; reuses a valid inbound one
     Origin: evil.example → 403 { error: { code:"FORBIDDEN", ... } }
     Origin: localhost:5173 → Access-Control-Allow-Origin + Allow-Credentials
POST 1.2MB body           → 413 PAYLOAD_TOO_LARGE
POST malformed JSON       → 400 BAD_REQUEST
SIGTERM                   → drains HTTP, disconnects redis + mongo, exits 0
```

Logs confirmed: pretty in dev, 404 logged at WARN with the correlation id, and
`/api/health` excluded from request logging so keep-alive pings do not flood it.

### Next phase

**Phase 2 — Auth, Users, Teams:** register/login/refresh/logout/me, bcrypt
(cost 12), refresh-token rotation with reuse detection, `requireAuth` and
`requireRole('admin')`, Redis-backed rate limiting on auth routes, Cloudinary
signed avatar uploads, team create/invite/join/roles, and demo mode
(`POST /api/auth/demo` + seed script). Target: auth module coverage ≥ 70%.

---

## Phase 0 — Scaffold & Tooling ✅

**Completed:** 2026-09-23

### Built

- npm workspaces monorepo (`client`, `server`, `shared`) with root scripts
  `dev`, `build`, `lint`, `typecheck`, `test`, `format`.
- `shared/` package: zod-first contract layer. Ships `healthResponseSchema`,
  compiled to `dist/` with type declarations so both sides consume real types.
- `server/`: Express 5 + TypeScript (ESM), `GET /api/health`, and a
  zod-validated environment loader that fails fast at startup.
- `client/`: React 19 + Vite 7 + Tailwind CSS v4 + shadcn/ui (new-york,
  neutral). Renders live API health fetched through the same-origin `/api` path.
- Tooling: ESLint 9 flat config, Prettier 3, Husky hooks, lint-staged,
  commitlint (Conventional Commits).
- `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22).
- `docker-compose.yml` for local MongoDB 7 + Redis 7.
- `.env.example` for server and client; `README.md` and this file.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| Vite dev proxy `/api` → `localhost:5000` instead of CORS in dev | Production sends REST through a Vercel rewrite so the browser sees the API as same-origin (keeping the refresh cookie first-party). Proxying in dev makes local behaviour match production instead of only working because CORS is open. |
| `shared/` compiled to `dist/` rather than consumed as raw TS | The server's production build (`tsc` → `dist`) cannot emit code that lives in `node_modules`. Building `shared` first keeps the Docker/Render build correct. Cost: `npm run dev` runs a third `tsc --watch` process. |
| ESM + `NodeNext` on the server (explicit `.js` in relative imports) | Matches Node 22's native module system and avoids a CJS/ESM interop layer later (BullMQ, Socket.io, ffmpeg tooling are all ESM-friendly). |
| Env vars validated as plain non-empty strings, not URLs | Real values use `mongodb+srv://` and `rediss://` schemes that URL validators treat inconsistently. |
| shadcn/ui configured by hand (`components.json` + `Button` + tokens) rather than running the interactive `init` | Deterministic and reviewable. `components.json` is the real thing, so `npx shadcn@latest add <component>` works normally from here. |
| `.nvmrc` = 22 while the dev machine runs Node 24 | The plan locks Node 22 LTS, which is what Docker/Render will use. `engines` is `>=22`, so Node 24 is fine locally. |
| ESLint uses `typescript-eslint` recommended (not type-checked) | Keeps `npm run lint` fast on a growing monorepo. Type errors are already caught by `npm run typecheck`. |

### Known limitations

- Husky hooks are on disk but inert until the folder is a git repository and
  `npm run prepare` has been run once.
- On `npm run dev`, Vite serves the page a second or two before the API is
  listening, so the first health fetch can fail. The card has a **Re-check**
  button; a retry/suspense layer arrives with TanStack Query in Phase 4.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ 2 passed (1 server, 1 client) |
| `npm run build` | ✅ all 3 workspaces |
| `npm run dev` | ✅ client 5173 + API 5000; health reaches the page through the proxy |

---
