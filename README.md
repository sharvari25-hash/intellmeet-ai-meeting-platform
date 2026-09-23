# IntellMeet

> AI-powered enterprise meeting and collaboration platform — real-time video meetings that turn themselves into transcripts, summaries, decisions and tracked tasks.

**Status:** 🚧 In development — Phase 4 (frontend foundation) complete. The web
app runs: landing page, demo sign-in, dashboard, teams and invites.

---

## What it does

- Sign up, create or join a **team workspace**, invite members
- **Real-time video meetings** (WebRTC) with chat, screen sharing, participant list and recording
- After a meeting, **AI produces** a transcript, summary, key decisions and action items with assignees
- Action items become **Kanban tasks** with real-time board sync
- Searchable, exportable **meeting history** plus an **analytics dashboard**

## Tech stack

| Layer | Choice |
| --- | --- |
| Monorepo | npm workspaces (`client/`, `server/`, `shared/`) |
| Frontend | React 19, TypeScript, Vite 7, React Router 7, Tailwind CSS v4, shadcn/ui, lucide-react |
| Client state | TanStack Query (server state), Zustand (session, theme, socket) |
| Forms | react-hook-form + the shared zod schemas; sonner for toasts |
| Backend | Node.js 22 LTS, Express 5, TypeScript, helmet, pino |
| Database | MongoDB Atlas + Mongoose |
| Cache / jobs | Redis (ioredis) + BullMQ *(Phase 6)* |
| Real-time | Socket.io (+ Redis adapter); WebRTC mesh client *(Phase 5)* |
| AI | Groq (Whisper + Llama), Gemini fallback, Mock provider *(Phase 6)* |
| Testing | Vitest, Supertest, React Testing Library, Playwright |
| Tooling | ESLint 9 (flat config), Prettier, Husky, lint-staged, commitlint |
| Deploy | Vercel (client) + Render (server) — **no AWS** |

## Prerequisites

- **Node.js 22+** (`.nvmrc` pins 22 — run `nvm use`)
- **npm 10+**
- **Docker Desktop** — provides local MongoDB + Redis, both required

## Quick start

```bash
# 1. Install every workspace's dependencies from the repo root
npm install

# 2. Create local env files
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Set JWT_SECRET in server/.env (the server refuses to start without it)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Start MongoDB + Redis (required - the API will not boot without them)
docker compose up -d

# 5. Seed the demo workspace so the landing page's "Try Live Demo" button works
npm run seed -w @intellmeet/server

# 6. Run the client and the API together
npm run dev
```

Then open <http://localhost:5173> and press **Try Live Demo** — no sign-up
needed. It drops you into a seeded team with three colleagues.

| URL | What |
| --- | --- |
| <http://localhost:5173> | Web client (Vite) |
| <http://localhost:5000/api/health> | Liveness + per-dependency status (always 200) |
| <http://localhost:5000/api/health/ready> | Readiness (503 if Mongo or Redis is down) |

The client calls the API on the **same-origin `/api` path**. In development Vite
proxies that path to `localhost:5000`; in production `client/vercel.json`
rewrites it to the Render service. The frontend never needs an API base URL.

## Scripts (run from the repo root)

| Script | What it does |
| --- | --- |
| `npm run dev` | Builds `shared`, then runs shared-watch + API + client together |
| `npm run build` | Production build of all three workspaces, in dependency order |
| `npm run lint` | ESLint across the monorepo |
| `npm run lint:fix` | ESLint with autofix |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | Vitest suites in every workspace |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (used in CI) |

Target a single workspace with `-w`, e.g. `npm run test -w @intellmeet/server`.
Server coverage: `npm run test:coverage -w @intellmeet/server`.

## API overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | – | Liveness + per-dependency status |
| GET | `/api/health/ready` | – | Readiness (503 when a dependency is down) |
| POST | `/api/auth/register` | – | Create an account |
| POST | `/api/auth/login` | – | Sign in (5 attempts / 15 min per IP+email) |
| POST | `/api/auth/demo` | – | Sign in as the seeded demo account |
| POST | `/api/auth/refresh` | cookie | Rotate the refresh token |
| POST | `/api/auth/logout` | cookie | End the session (idempotent) |
| GET | `/api/auth/me` | Bearer | Current user |
| GET | `/api/users/me` | Bearer | Current user |
| PATCH | `/api/users/me` | Bearer | Update name / avatar |
| GET | `/api/uploads/signature` | Bearer | Cloudinary signed direct-upload params |
| POST | `/api/teams` | Bearer | Create a team |
| GET | `/api/teams` | Bearer | List my teams |
| GET | `/api/teams/:id` | Bearer | Get a team (members only) |
| POST | `/api/teams/:id/invites` | Bearer | Mint an invite code (team admin) |
| POST | `/api/teams/join` | Bearer | Redeem an invite code |
| DELETE | `/api/teams/:id/members/:userId` | Bearer | Remove a member (team admin) |
| PATCH | `/api/teams/:id/members/:userId` | Bearer | Change a member's role (team admin) |
| POST | `/api/meetings` | Bearer | Create a meeting (schedule, or start now) |
| GET | `/api/meetings` | Bearer | List meetings (filter, search, paginate) |
| GET | `/api/meetings/:id` | Bearer | Get a meeting |
| GET | `/api/meetings/code/:roomCode` | Bearer | Resolve a room code (join by link) |
| PATCH | `/api/meetings/:id` | Bearer | Edit a meeting (host) |
| POST | `/api/meetings/:id/start` | Bearer | Start a scheduled meeting (host) |
| POST | `/api/meetings/:id/end` | Bearer | End a meeting (host) |
| DELETE | `/api/meetings/:id` | Bearer | Delete a non-live meeting (host) |
| GET | `/api/meetings/:id/messages` | Bearer | Chat history (cursor paginated) |
| GET | `/api/notifications` | Bearer | List notifications + unread count |
| PATCH | `/api/notifications/:id/read` | Bearer | Mark one read |
| PATCH | `/api/notifications/read-all` | Bearer | Mark all read |
| GET | `/api/rtc/ice-servers` | Bearer | STUN/TURN config for WebRTC |

## Real-time (Socket.io)

The client connects **directly to the API origin**, not through the Vercel
rewrite, because a rewrite cannot proxy a WebSocket upgrade — hence
`VITE_SOCKET_URL`. The access token travels in the handshake `auth` payload
rather than a cookie: a Vercel-scoped cookie is never sent on that cross-origin
socket, and a browser cannot set an `Authorization` header on a WebSocket.

Event names and payload schemas live in `shared/src/socketEvents.ts`, so both
sides import the same constants instead of re-typing strings.

| Group | Events |
| --- | --- |
| Room | `room:join` `room:leave` `room:participants` `room:user-joined` `room:user-left` `room:host-mute` `room:end` |
| WebRTC | `rtc:offer` `rtc:answer` `rtc:ice-candidate` (targeted by socket id, relayed verbatim) |
| Media | `media:toggle` |
| Chat | `chat:send` `chat:message` `chat:typing` `chat:stop-typing` |
| Presence | `presence:online` `presence:offline` |
| Notifications | `notify:new` |
| Errors | `socket:error` (same `{ code, message }` vocabulary as REST) |

The handshake proves identity only; room access is re-checked on `room:join`.
Signalling is relayed without being parsed — media never touches the server.

## Web client

| Route | Access | What |
| --- | --- | --- |
| `/` | public | Landing page with the **Try Live Demo** button |
| `/login`, `/register` | signed out | Auth forms built on the shared zod schemas |
| `/join/:code` | public | Redeems a team invite; signs you in first if needed |
| `/app` | protected | Dashboard — start a meeting, join by code, recent meetings |
| `/app/teams`, `/app/teams/:id` | protected | Create/join a team, members, invite link |
| `/app/settings` | protected | Display name, theme, backend health |
| `/app/meetings`, `/app/room/:code`, `/app/tasks`, `/app/analytics` | protected | Wired and guarded; their features land in Phases 5–9 |

**Client auth.** The access token lives in a plain JavaScript variable — never
in `localStorage`, which any script on the origin can read. A hard reload
therefore starts with no token, and the app exchanges the httpOnly refresh
cookie for a new one before deciding where to route you; until that settles the
session status is `bootstrapping`, so a signed-in user is never bounced to
`/login` mid-reload. A 401 triggers one refresh and one retry, and concurrent
401s are funnelled into a **single** refresh request — four parallel rotations
of the same cookie would look exactly like a replayed token to the server.

The signed-in half of the app is a lazy chunk, so a visitor reading the landing
page never downloads the dashboard or socket.io-client.

**Auth model.** The access token is a 15-minute JWT returned in the response
body and held in memory by the client. It is sent as `Authorization: Bearer …`
and never as a cookie, so nothing the browser attaches automatically can
authenticate a protected route — which makes CSRF structurally impossible on
every protected endpoint. The refresh token is opaque (not a JWT), stored only
as a SHA-256 hash, rotated on every refresh, and lives in an httpOnly,
`SameSite=Lax` cookie scoped to `/api/auth`.

Every sign-in starts a **token family**, and each rotation inherits it.
Presenting a token that has already been rotated is treated as theft and
revokes **that family only** — not the account's other sessions, which matters
because the demo account is shared by every reviewer. A replay within
`REFRESH_REUSE_GRACE_MS` (10s) while the family is still live is treated as a
concurrent refresh instead: two browser tabs are separate JavaScript contexts
and will race, so without the window a second tab would look exactly like an
attack. `MAX_SESSIONS_PER_USER` caps retained tokens, pruning expired then
oldest.

**Roles.** `role` on a user is platform-wide and gates cross-tenant operations.
A separate per-team role (`members[].role`) gates everything tenant-scoped —
inviting, removing members and changing roles. A non-member receives 404 for a
team rather than 403, so the existence of other tenants' teams is not leaked.

## API error format

Every non-2xx response has the same body, so the client needs one error path:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "body.email", "message": "Invalid email" }],
    "requestId": "9f139dc7-5135-482b-9846-7f18fa812fc0"
  }
}
```

`code` is one of ten stable values defined in `shared/src/errors.ts` — switch on
it rather than on the message. `requestId` matches the `X-Request-Id` response
header and the server logs for that request.

## Repository layout

```
.
├── client/     React 19 + Vite web app          → Vercel
├── server/     Express 5 + Socket.io API        → Render
├── shared/     zod schemas + types used by both
├── docs/       architecture, API and report notes
└── docker-compose.yml   local MongoDB + Redis
```

## Environment variables

Nothing secret is committed. Each workspace ships a documented
`.env.example`; copy it to `.env` and fill in.

- `server/.env` — validated by zod at startup (`server/src/config/env.ts`); the
  process exits with a readable message if a variable is missing or malformed.
- `client/.env` — only `VITE_`-prefixed variables reach the browser, so they
  are **public by definition**.

## Git hooks

Hooks live in `.husky/` and activate once the repo is a git repository:

```bash
git init          # if not already a repo
npm run prepare   # points git at .husky/
```

- **pre-commit** → `lint-staged` (ESLint + Prettier on staged files)
- **commit-msg** → `commitlint` (Conventional Commits)

## Documentation

- [`PROGRESS.md`](./PROGRESS.md) — running build log: what was done, decisions, limitations
- `docs/` — architecture diagrams, API reference and report notes (later phases)

## Roadmap

Phase 0 scaffold ✅ · Phase 1 backend foundation ✅ · Phase 2 auth/teams ✅ ·
Phase 3 meetings + Socket.io ✅ · Phase 4 frontend foundation ✅ · Phase 5 meeting room ·
Phase 6 recording + AI · Phase 7 history · Phase 8 Kanban · Phase 9 analytics ·
Phase 10 quality · Phase 11 Docker/K8s/CI · Phase 12 deploy · Phase 13
observability · Phase 14 docs & demo.

## License

Private / unpublished.
