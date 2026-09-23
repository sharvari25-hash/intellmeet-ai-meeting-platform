# IntellMeet — Build Progress Log

Running record of what was built, why it was built that way, what is known to
be missing, and what comes next. Updated at the end of every phase.

---

## Phase 2 — Auth, Users, Teams ✅

**Completed:** 2026-09-23

### Built

- **Auth**: `POST /api/auth/register | login | refresh | logout | demo`,
  `GET /api/auth/me`. bcrypt (cost 12), opaque refresh tokens stored as
  SHA-256 hashes, rotation on every refresh with **reuse detection** that
  revokes every session.
- **Access/refresh split**: 15-minute JWT access token returned in the body
  (client holds it in memory); 7-day opaque refresh token in an httpOnly,
  `SameSite=Lax`, `Path=/api/auth` cookie.
- **`requireAuth` / `requireRole`** middleware, plus `currentUser(req)` so
  controllers never need a non-null assertion.
- **Rate limiting**: 5 login attempts / 15 min per **IP + email**, 30 other
  auth requests / 15 min per IP, 30 writes / min. Redis store in dev and
  production, in-memory under test.
- **Users**: `GET/PATCH /api/users/me`, with `publicUserSchema` as the only
  shape that leaves the server.
- **Uploads**: `GET /api/uploads/signature` returning Cloudinary signed
  direct-upload parameters. Cloudinary is **optional** — unconfigured returns
  `SERVICE_UNAVAILABLE` and nothing else breaks.
- **Teams**: create, list mine, get, invite, join by code, remove member,
  change role — all scoped to membership, with a team-level admin role that is
  separate from the platform role.
- **Demo mode**: idempotent seed script (`npm run seed -w @intellmeet/server`)
  creating a demo user, three teammates and a demo team; `POST /api/auth/demo`
  signs in with no credentials.
- `.gitattributes` with `* text=auto eol=lf`.
- `docker-compose.yml` now sets `name: intellmeet`.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Refresh token is opaque + SHA-256 hashed, not a JWT** | A JWT refresh token cannot be revoked without a denylist anyway, so the stateless benefit is illusory. SHA-256 rather than bcrypt because the token is 32 bytes of CSPRNG output: there is no low-entropy guess to slow down, and a deterministic digest is what makes the indexed lookup — and therefore reuse detection — possible at all. |
| **Rotated tokens are kept with `revokedAt`, not deleted** | That record *is* the reuse detector. The legitimate client and a thief cannot both keep refreshing, so whoever presents an already-rotated token proves the token was copied. Both are then logged out, because we cannot tell which is which. |
| **Access token is Bearer-only, never a cookie** | Nothing the browser attaches automatically can authenticate a protected route, so CSRF is structurally impossible on every route except `/api/auth/refresh` — and that one only rotates tokens and returns a body the attacker cannot read cross-origin. |
| **No DB round trip in `requireAuth`** | Keeps authenticated requests cheap. The cost is that a role change or deletion takes effect at the next refresh rather than instantly, which is why the access-token TTL is 15 minutes. |
| **Identical error message for "wrong password" and "no such account"**, plus a dummy bcrypt comparison | Different messages enumerate accounts; different *timings* enumerate them just as reliably. `burnPasswordComparison()` equalises the ~350ms. |
| **Login limiter keys on IP *and* email** | IP alone punishes everyone behind one NAT when a colleague fat-fingers a password. Email alone lets an attacker lock a victim out by deliberately failing. The pair throttles stuffing against one account without collateral damage. |
| **`bcryptjs`, not native `bcrypt`** | Production is `node:22-alpine` (musl), where native prebuilds routinely miss and the build falls back to compiling inside the image. Pure JS builds identically everywhere; ~2-3x slower per hash, which is irrelevant at login rates. |
| **`BCRYPT_COST` lowered to 4 under test** | The suite hashes hundreds of passwords. Deliberate slowness proves nothing in a test and would add minutes. |
| **Non-member gets 404 on a team, not 403** | 403 confirms "this team exists, you just cannot see it", leaking the existence of other tenants' teams. A member who lacks *admin* does get 403, because the team's existence is not a secret to them. |
| **Invite codes stored in plain text** | Unlike a refresh token, an invite code is meant to be copied into a chat and typed by hand; hashing would stop the admin ever seeing it again. It is short-lived (7 days), revocable, and only grants "join one team as a member". |
| **Cloudinary signed via the official SDK's `api_sign_request`, with the secret passed per call** | Avoids reimplementing the signing algorithm, and avoids the SDK's global `config()` singleton — so the function is pure and testable with throwaway credentials. |
| **Cloudinary "mocked" by configuration, not by stubbing** | Signing is a pure local computation, so the tests use fake credentials and recompute the signature with the real algorithm. Stronger than a stub, which would only assert against a hand-written fake. |
| **Team role is separate from platform role** | Almost every authorisation check in the product is tenant-scoped. `requireRole('admin')` is reserved for cross-tenant operations; `getTeamForAdmin` does the per-team check. |
| **Seed script is idempotent** | It will be pointed at the production database after deploy (Phase 12 step 8). Re-running must not duplicate members. |

### Bugs found by running it (not by the tests)

1. **MongoDB rejects `$push` + `$pull` on the same array path.** Both
   `startSession` and `refresh` hit `"Updating the path 'refreshTokens' would
   create a conflict"`. Restructured as ordered `bulkWrite` operations. In
   `refresh` the order is deliberately revoke-then-issue: if the second
   operation were lost the user just signs in again, whereas the reverse order
   would briefly leave two valid tokens — exactly what rotation prevents.
2. **`rate-limit-redis` calls Redis in its constructor.** The limiters were
   module-level constants evaluated when `app.ts` imported the routers, which
   happens *before* `bootstrap()` calls `connectRedis()` — so the process
   crashed on startup. The tests never saw it because they use the in-memory
   store. Limiters are now built lazily on first request.
3. **`z.url()` accepts `javascript:alert(1)`.** It is a syntactically valid
   URL. Stored as an avatar and later rendered into an attribute, that is
   stored XSS. Added `httpsUrlSchema`, which checks the *parsed* protocol
   (so `JavaScript:`, leading whitespace and embedded newlines are all
   normalised away before the check).
4. **A blank `CLOUDINARY_*=` line would refuse to boot.** `.optional()` only
   accepts `undefined`, so `KEY=` arrives as `''` and fails `.min(1)` — and a
   blank value is exactly how Render expresses an unset variable. Empty
   strings are now normalised to "not set".

Also improved from Phase 1: the error handler preserved only a generic
`"Internal server error"` message on unexpected 500s, which made the first
failure above invisible in a test run (`LOG_LEVEL=silent`). It now keeps the
original message, still masked in production.

### Known limitations

- Google OAuth2 skipped by decision. `authProviderSchema` is `local | demo`;
  `google` gets added if it is implemented later.
- Cloudinary has no credentials yet, so the upload path is exercised only up
  to the signature. The browser-to-Cloudinary leg is unverified until an
  account exists.
- The seed script creates users and a team only. Meetings, insights and tasks
  are added in Phases 3, 6 and 8 when those models exist.
- No "active sessions" UI yet, though `userAgent`/`ip` are recorded per
  refresh token specifically so one can be built.
- No email verification or password reset — not in the plan's scope.
- The demo account is shared and writable; Phase 4 should make destructive
  actions on it obvious in the UI.
- `requireRole('admin')` has no route using it yet (no platform-admin surface
  exists), so it is covered by unit-level reasoning rather than an endpoint test.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **106 passed** (103 server, 3 client) |
| Auth module coverage | ✅ **97.9% statements**, 86.4% branches (checkpoint requires ≥ 70%) |
| Teams module coverage | ✅ 99.2% statements |
| Users / uploads coverage | ✅ 100% statements |
| Overall server coverage | ✅ 87.1% statements |
| `npm run build` | ✅ all 3 workspaces |

### Manual verification performed

Against the real Docker MongoDB and Redis, after `npm run seed`:

```
POST /api/auth/demo               → 200, demo user, 15-min access token
GET  /api/auth/me                 → 200, correct user
GET  /api/teams                   → 200, seeded team, 4 members, myRole=admin
POST /api/auth/refresh  (valid)   → 200  (rotates)
POST /api/auth/refresh  (rotated) → 200  (chain continues)
POST /api/auth/refresh  (replay)  → 401  "Session revoked"   ← reuse detected
POST /api/auth/refresh  (legit)   → 401                       ← all sessions revoked
5x bad login                      → 401, 6th → 429
GET  /api/uploads/signature       → 503 SERVICE_UNAVAILABLE   (no Cloudinary yet)
npm run seed (run twice)          → still 4 members, no duplicates
```

Redis was inspected directly to confirm the counters are genuinely distributed
rather than per-process:

```
rl:login:::1|demo@intellmeet.app => 6
rl:auth:::1
```

### Next phase

**Phase 3 — Meetings API, Socket.io, Chat, Presence, Notifications:** meeting
CRUD scoped to team membership, unique short room codes, Socket.io with the
Redis adapter and a JWT handshake (reusing `verifyAccessToken`), room
join/leave and participant tracking, WebRTC signalling relay, persisted chat
with pagination, presence, notifications, and `GET /api/rtc/ice-servers`.

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
