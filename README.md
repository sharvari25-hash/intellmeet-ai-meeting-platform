# IntellMeet

> AI-powered enterprise meeting and collaboration platform — real-time video meetings that turn themselves into transcripts, summaries, decisions and tracked tasks.

**Status:** 🚧 In development — Phase 1 (backend foundation) complete.

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
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS v4, shadcn/ui, lucide-react |
| Backend | Node.js 22 LTS, Express 5, TypeScript, helmet, pino |
| Database | MongoDB Atlas + Mongoose |
| Cache / jobs | Redis (ioredis) + BullMQ *(Phase 6)* |
| Real-time | Socket.io + WebRTC mesh *(Phase 3/5)* |
| AI | Groq (Whisper + Llama), Gemini fallback, Mock provider *(Phase 6)* |
| Testing | Vitest, Supertest, React Testing Library, Playwright |
| Tooling | ESLint 9 (flat config), Prettier, Husky, lint-staged, commitlint |
| Deploy | Vercel (client) + Render (server) — **no AWS** |

## Prerequisites

- **Node.js 22+** (`.nvmrc` pins 22 — run `nvm use`)
- **npm 10+**
- **Docker Desktop** (optional until Phase 1 — provides local MongoDB + Redis)

## Quick start

```bash
# 1. Install every workspace's dependencies from the repo root
npm install

# 2. Create local env files (defaults work out of the box)
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Start MongoDB + Redis (required - the API will not boot without them)
docker compose up -d

# 4. Run the client and the API together
npm run dev
```

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

Phase 0 scaffold ✅ · Phase 1 backend foundation · Phase 2 auth/teams · Phase 3
meetings + Socket.io · Phase 4 frontend foundation · Phase 5 meeting room ·
Phase 6 recording + AI · Phase 7 history · Phase 8 Kanban · Phase 9 analytics ·
Phase 10 quality · Phase 11 Docker/K8s/CI · Phase 12 deploy · Phase 13
observability · Phase 14 docs & demo.

## License

Private / unpublished.
