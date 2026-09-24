# IntellMeet

> AI-powered enterprise meeting and collaboration platform — real-time video meetings that turn themselves into transcripts, summaries, decisions and tracked tasks.

[![CI](https://github.com/sharvari25-hash/intellmeet-ai-meeting-platform/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sharvari25-hash/intellmeet-ai-meeting-platform/actions/workflows/ci.yml)
[![Docker](https://github.com/sharvari25-hash/intellmeet-ai-meeting-platform/actions/workflows/docker.yml/badge.svg?branch=main)](https://github.com/sharvari25-hash/intellmeet-ai-meeting-platform/actions/workflows/docker.yml)

**Status:** 🚧 In development — Phases 0-9 and 11 (Docker, Kubernetes, Helm,
CI/CD) complete; deployment (Phase 12) is next, the quality pass (Phase 10)
after it. Real WebRTC
meetings work end to end; a recorded meeting turns itself into a transcript,
a summary, key decisions and owned action items; every past meeting is
searchable, correctable by its host and exportable; action items become tasks
on a Kanban board that two browsers edit together live; and an analytics
dashboard charts the team's meetings, attendance and follow-through, with CSV
export. Everything runs with no third-party accounts (`AI_PROVIDER=mock`,
local recording storage).

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
| Drag and drop | dnd-kit (mouse, touch and keyboard) |
| Charts | Recharts (its own lazy chunk; every chart also a table) |
| Backend | Node.js 22 LTS, Express 5, TypeScript, helmet, pino |
| Database | MongoDB Atlas + Mongoose |
| Cache / jobs | Redis (ioredis) + BullMQ (post-meeting AI job, worker in-process) |
| Real-time | Socket.io (+ Redis adapter); WebRTC mesh (perfect negotiation) |
| AI | Google Gemini (3.5 Flash, falling back through 3.6-3.8 Flash) for transcription and analysis; Groq (Whisper + Llama 3.3) supported; deterministic Mock provider |
| Testing | Vitest, Supertest, React Testing Library, Playwright |
| Tooling | ESLint 9 (flat config), Prettier, Husky, lint-staged, commitlint |
| Containers | Multi-stage Docker images (Node 22 Alpine API, unprivileged nginx client), `docker-compose.prod.yml` |
| Kubernetes | Kustomize manifests + a Helm chart (HPA, sticky Ingress, restricted Pod Security) |
| CI/CD | GitHub Actions: lint, typecheck, tests with coverage, build and Playwright on every PR; images to GHCR on `main` |
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
needed. You get a guest identity of your own (a generated name like "Amber
Otter") in a seeded team with three colleagues, three detailed past meetings
with transcripts, summaries, chat and action items, eight weeks of shorter
meetings before those (so **Analytics** has a history to chart), and a task
board with work in every column. Press it again in a private window and you
are a second, different person in the same team, on the same board.

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
| `npm run test:e2e` | Playwright: analytics (charts, tables, live update, safe CSV, 360 px), two guests on one board (create, drag, live move, comment + mention), action item → task, demo identity, history search + export, two browsers in one meeting, record → AI → edit → export (needs Docker + seed; cleans up after itself). `E2E_BASE_URL` / `E2E_API_URL` point it at other ports |
| `npm run dev:https` | Dev over HTTPS on the LAN, for testing from a phone |
| `npm run eval:ai -w @intellmeet/server` | Scores the AI provider on the sample transcripts in `server/fixtures/` |
| `npm run worker -w @intellmeet/server` | Standalone AI worker (only with `RUN_WORKER_IN_PROCESS=false`) |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check (used in CI) |

Target a single workspace with `-w`, e.g. `npm run test -w @intellmeet/server`.
Coverage: `npm run test:coverage -w @intellmeet/server` (or `-w
@intellmeet/client`); CI runs both on every pull request.

## API overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | – | Liveness + per-dependency status |
| GET | `/api/health/ready` | – | Readiness (503 when a dependency is down) |
| POST | `/api/auth/register` | – | Create an account |
| POST | `/api/auth/login` | – | Sign in (5 failed attempts / 15 min per IP+email) |
| POST | `/api/auth/demo` | – | "Try Live Demo": create a guest in the demo team and sign in as it |
| DELETE | `/api/auth/demo` | Bearer | End a guest's demo session: delete the guest and what it made (guests only) |
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
| GET | `/api/meetings` | Bearer | Meeting history: `status`, `teamId`, `page`; `q` searches titles, summaries and transcripts and says where each matched |
| GET | `/api/meetings/:id` | Bearer | Get a meeting |
| GET | `/api/meetings/code/:roomCode` | Bearer | Resolve a room code (join by link) |
| PATCH | `/api/meetings/:id` | Bearer | Edit a meeting (host) |
| POST | `/api/meetings/:id/start` | Bearer | Start a scheduled meeting (host) |
| POST | `/api/meetings/:id/end` | Bearer | End a meeting (host) |
| DELETE | `/api/meetings/:id` | Bearer | Delete a non-live meeting (host) |
| GET | `/api/meetings/:id/messages` | Bearer | Chat history (cursor paginated) |
| GET | `/api/meetings/:id/recording/upload-target` | Bearer | Where to upload a recording: Cloudinary or this API (host) |
| POST | `/api/meetings/:id/recording` | Bearer | Register a Cloudinary recording and queue the AI job (host) |
| PUT | `/api/meetings/:id/recording/file` | Bearer | Upload the raw audio when Cloudinary is not configured (host) |
| GET | `/api/meetings/:id/recording/audio` | Bearer | The recording's audio (Range supported) |
| GET | `/api/meetings/:id/intelligence` | Bearer | AI status, transcript and insight in one response |
| PATCH | `/api/meetings/:id/insight` | Bearer | Correct the summary, decisions or action items (host) |
| POST | `/api/meetings/:id/ai/retry` | Bearer | Re-queue a failed AI run (host) |
| POST | `/api/meetings/:id/tasks` | Bearer | Turn one or many action items into tasks on the team board |
| GET | `/api/boards?teamId=` | Bearer | A team's boards (creates the default one on first use) |
| POST | `/api/boards` | Bearer | Create a board (team admin) |
| GET | `/api/boards/:id` | Bearer | A board with its columns and tasks |
| PATCH / DELETE | `/api/boards/:id` | Bearer | Rename / delete a board (team admin; not the default one) |
| POST | `/api/boards/:id/columns` | Bearer | Add a column (team admin) |
| PUT | `/api/boards/:id/columns` | Bearer | Reorder columns: the full list of ids (team admin) |
| PATCH / DELETE | `/api/boards/:id/columns/:columnId` | Bearer | Rename or mark done / remove an empty column (team admin) |
| POST | `/api/boards/:id/tasks` | Bearer | Create a task (bottom of a column) |
| GET | `/api/tasks/mine` | Bearer | Tasks assigned to me across every board |
| GET / PATCH / DELETE | `/api/tasks/:id` | Bearer | Read / edit / delete a task (samples: admin only; delete: creator or admin) |
| POST | `/api/tasks/:id/move` | Bearer | Move: `{ columnId, afterId, beforeId }` |
| GET / POST | `/api/tasks/:id/comments` | Bearer | A task's comments / add one (`@mentions` notify) |
| GET | `/api/analytics/overview` | Bearer | Headline numbers for a team and range: `teamId`, `from`, `to` (`YYYY-MM-DD`, default the last 8 weeks), `tz` (IANA, default UTC). Members only |
| GET | `/api/analytics/weekly` | Bearer | Per week (Monday-based, in `tz`): meetings, minutes, average length and attendance, action items raised and done |
| GET | `/api/analytics/members` | Bearer | Per person: meetings attended and hosted, time in meetings, messages, action items owned and done, task completion, activity |
| GET | `/api/analytics/export` | Bearer | The weekly or members table as CSV (`dataset=weekly\|members`), formula-safe |
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
| Recording / AI | `recording:state` (host → room, drives the indicator), `ai:status` (server → team) |
| Chat | `chat:send` `chat:message` `chat:typing` `chat:stop-typing` (an `@name` in a message notifies that team-mate) |
| Boards | `board:join` `board:leave` (client → server, membership checked); `task:created` `task:updated` `task:moved` `task:deleted` `task:commented` `board:refresh` (server → `board:<id>`) |
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
| `/app/room/:code` | protected | **Meeting room** — lobby, mesh video, screen share, chat, recording |
| `/app/meetings` | protected | **Meeting history** — upcoming/live/past, search across titles, summaries and transcripts, pagination (all in the URL) |
| `/app/meetings/:id` | protected | **Meeting page** — tabs for summary, action items, transcript (search, click-to-seek), chat and recording; host editing; export |
| `/app/tasks` | protected | **Team board** (drag and drop, live) and **My tasks**; `?board=`, `?task=`, `?view=mine` in the URL |
| `/app/analytics` | protected | **Analytics** — KPI tiles and five charts (each with a summary and a table), team and period filters, CSV export; `?team=`, `?weeks=` or `?from=&to=` in the URL |

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

## Meeting room

Video is a **WebRTC mesh**: one peer connection per participant, media directly
between browsers, and the server used only to pass SDP and ICE along. It never
sees a frame. That keeps hosting free and latency low, at the cost of upstream
bandwidth growing with the participant count — the room warns above six, and
`docs/architecture.md` documents the LiveKit (SFU) upgrade path.

Everything above the transport talks through a `MediaTransport` interface, so
swapping the mesh for an SFU replaces one class and leaves the UI untouched.

**Meetings nobody ended end themselves.** A closed tab or a server restart
never presses **End for all**. A live meeting nobody has been connected to for
`LIVE_MEETING_IDLE_MIN` (10) minutes is ended by the housekeeping sweep (30 s
after startup, then every 5 minutes), dated to when its room emptied. After a
restart the room page rejoins by itself, so a call that is still going is
never mistaken for an abandoned one.

**Testing it from a phone.** Browsers only allow camera and microphone access
in a secure context — HTTPS, or localhost. A phone opening
`http://192.168.x.x:5173` has no camera API at all:

```bash
npm run dev:https          # self-signed HTTPS, bound to every interface
```

Open `https://<your-laptop-ip>:5173` on the phone and accept the certificate
warning once. A self-signed certificate was chosen over a tunnel (ngrok,
cloudflared) because it needs no account and no third party — and, more
importantly, because it keeps the phone on the **same LAN**, where STUN alone
is enough. A tunnel would put the phone behind carrier-style NAT and make TURN
a prerequisite. `PROGRESS.md` has the step-by-step script.

**STUN only, for now.** `GET /api/rtc/ice-servers` reports `hasTurn: false` and
the room shows a banner saying so. Two machines on the same WiFi, or two home
broadband connections, connect fine — roughly 80–90% of real cases. A corporate
or university network that blocks UDP, or somebody joining on mobile data
behind carrier-grade NAT, will **not** connect without a relay. Add TURN before
demonstrating on a network you do not control:

```bash
TURN_URLS=turn:standard.relay.metered.ca:80,turns:standard.relay.metered.ca:443
TURN_USERNAME=…
TURN_CREDENTIAL=…
```

## Recording & AI meeting intelligence

The host presses **Record**. Every participant sees a red *Recording* badge,
and the host's browser mixes everyone's audio (Web Audio) into one Opus track
(`MediaRecorder`, ~32 kbps). On **Stop** the file is uploaded and a BullMQ job
runs:

1. **Download.** Anything over the provider's limit is split with ffmpeg into
   10-minute chunks.
2. **Transcribe** with Gemini (the browser's `audio/webm;codecs=opus` as it
   is) → a timestamped Transcript.
3. **Analyse** with Gemini → strict JSON `{summary, keyDecisions,
   actionItems}`, validated with zod, with one repair round trip if the reply
   is invalid.
4. **Match owners** fuzzily to the people who attended ("grace" → Grace
   Hopper; an ambiguous name → no owner rather than the wrong one).
5. **Save** the insight, push `ai:status` at every step, and notify attendees.

The meeting page (`/app/meetings/:id`) shows the steps live, then the result.
Failures retry with exponential backoff; a final failure shows the reason and
a **Retry** button to the host.

**Gemini is the production provider** (Groq, the plan's first choice, is
blocked on the development network; it is still supported). The free tier
allows **20 requests a day per model**, failed ones included, and a recorded
meeting needs at least two; its load also comes and goes. So three layers
stand between a busy model and a failed meeting: each call retries a 429/5xx
once (3 s, or the pause Google asks for if under 20 s); then the next model in
`GEMINI_FALLBACK_MODELS` takes over from `GEMINI_MODEL` (`gemini-3.5-flash`,
then 3.6, 3.7 and 3.8 Flash: four daily allowances, about 40 meetings a day);
then the job queue retries with exponential backoff. A malformed request or a
rejected key stops at the first model, since every model would refuse it.
The stored transcript and summary name the model that wrote them.

**Works with no accounts.** `AI_PROVIDER=mock` (the default, and what the
test suites use) is deterministic and needs no key. Without Cloudinary,
recordings are uploaded to the API and kept in `server/.data/recordings`. To
use the real services, add to `server/.env`:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=…               # https://aistudio.google.com/apikey (free tier)
CLOUDINARY_CLOUD_NAME=…        # production: Render's disk is not durable
CLOUDINARY_API_KEY=…
CLOUDINARY_API_SECRET=…
```

**Measuring accuracy.** `npm run eval:ai -w @intellmeet/server [-- --provider
gemini]` runs the analysis over the sample transcripts in `server/fixtures/`
and prints every produced decision and action item next to a hand-written
reference, with owner and deadline checks (`--fixture <key>` runs one). The
mock gets 73% of action items fully correct; that is the floor a real model
has to beat. PROGRESS.md (Phase 11) has Gemini's numbers.

## Meeting history

`/app/meetings` lists every meeting in your teams, filtered as **All /
Upcoming / Live / Past** (upcoming soonest first, past most recently ended
first). Each past meeting shows the start of its summary and what it produced
("2 decisions · 4 action items, 3 open").

**Search looks inside meetings, not just at titles.** A query runs against the
three MongoDB text indexes — meeting titles and descriptions, AI summaries and
decisions, and transcripts — scoped to the teams you belong to, and the
results are merged by relevance (a title match counts most, a passing mention
in an hour of transcript least). Each result quotes the sentence that matched
with the words highlighted; a transcript match carries its timestamp and links
straight to that line, with the recording ready to play from there.

**The meeting page** has tabs for the summary and decisions, the action items,
the transcript (searchable; every timestamp plays the recording from that
moment), the chat log and the recording. The **host can correct the AI**: the
summary, the decisions, and each action item's text, owner, due date and done
state. Corrected output is marked "Edited by … on …".

**Export** is done in the browser, from what the page already shows: **Copy
summary** (plain text for chat), **Markdown** (a task list plus a timestamped
transcript) and **PDF** (`@react-pdf/renderer`, loaded only when first used).
The PDF uses the built-in Helvetica, so it covers Western European text; the
Markdown export keeps every character.

## Team boards and tasks

`/app/tasks` shows the team's board: **To Do / In Progress / Review / Done** to
start with. Cards drag within and between columns (mouse, touch, or the
keyboard from each card's grip), and everyone looking at the board sees it
happen: a drop is shown at once, saved as "between these two cards", and
broadcast to the board's room. Every task carries a version, so late or
duplicated events never undo a newer change.

- **Tasks** have an assignee, due date, priority, description, comments and,
  when made from a meeting, a link back to it. Overdue tasks are marked on
  the board and in **My tasks**, which lists everything assigned to you across
  every board.
- **From a meeting:** each action item has **Create task**, and **Create
  tasks for all** files the rest at once, with owners and due dates pre-filled
  from the AI. The item then shows where its task is ("In Progress").
- **@mentions** in meeting chat and task comments notify the person, live and
  in the bell.
- **Who may do what:** any member creates, moves and comments on any task and
  edits any but the sample ones; tasks are deleted by their creator or a team
  admin; boards and columns are the team admin's.

`docs/architecture.md` explains the fractional ordering, the versioning and
the permission rule.

## Analytics

`/app/analytics` shows one team at a time, for a period of whole weeks (the
last 4, 8 or 12, or any dates up to a year) counted in your own time zone,
weeks starting on Monday. Everything on the page follows the one filter row,
and all of it is in the URL.

- **Headline numbers:** meetings, time in meetings (and the average length),
  people per meeting, the share of action items done (and how many are
  overdue), and the share of tasks completed.
- **Charts:** meetings per week (line); action items raised and done per week
  (stacked columns); what became of the action items: done, open, overdue
  (donut); task completion by member (bars); most active members: meetings
  attended, action items owned, tasks completed (stacked bars).
- **Accessible by construction:** every chart has a one-sentence summary
  under its title and a table with every number it draws. Screen readers get
  the table (the SVG itself is hidden from them); **Show table** puts it on
  screen for keyboard users and anyone who wants the figures. The colours
  were checked for colour-blind separation in both themes, status colours
  always come with an icon and a word, and nothing animates for people who
  asked their system for reduced motion.
- **Export CSV:** the weekly table or the members table, for exactly the team
  and period on screen. Cells that a spreadsheet would run as a formula (a
  name starting `=`, `+`, `-`, `@`) are prefixed with `'`, and every text cell
  is quoted.

**What counts.** A meeting counts once it has ended and somebody joined it.
An action item is done when it was ticked off on the meeting page or its task
is in a column marked done; items belong to the week of the meeting that
raised them. Tasks count by when they were created, on any of the team's
boards. People are counted once per meeting, however often they rejoined.

**Who sees what.** Every analytics endpoint checks that the caller belongs to
the team, before any cache is read; anyone else gets "not found". A demo guest
belongs to the demo team (and any team it creates), and sees only those.

**Caching.** Each aggregation is cached in Redis for five minutes, and a
team's entries are dropped as soon as something that feeds them changes: a
task written, a meeting ended or deleted, minutes corrected, a done column
changed. Names and membership are never cached, so a rename shows at once.

## Demo mode: a guest per sign-in

**Try Live Demo** (`POST /api/auth/demo`) creates a **new guest account** each
time: a generated name ("Amber Otter"), no password, and membership of the
seeded demo team, so the sample meetings are there straight away. Two windows
(use a private one, or another browser) are two different people: each is
host of its own meetings only, and the AI assigns their action items to them
by name. Guests are plain team members — they cannot remove the seeded
team-mates or edit the sample meetings, whose host is the seeded Demo User.

Guests clean up after themselves:

- **Automatically.** Every `DEMO_CLEANUP_INTERVAL_MIN` (30) minutes the server
  removes guests idle for more than `DEMO_DATA_TTL_HOURS` (6) — no sign-in or
  token refresh in that time — together with the meetings they hosted, the
  teams they created and the tasks and comments they wrote, and sweeps other
  demo content older than the TTL. The **seeded team, its sample meetings and
  its sample tasks are never removed**, and neither is anything recent, which
  is what makes the sweep safe while people are using the product.
- **On request.** The account menu's **End demo session** (`DELETE
  /api/auth/demo`) deletes the guest and what it made immediately.
- **At a ceiling.** At most `DEMO_MAX_GUESTS` (200) guests exist at once; the
  endpoint is public and creates accounts, so beyond that it answers 503 until
  the sweep has made room.

**The seeded history.** Before the three detailed sample meetings come eight
weeks of shorter ones (22 meetings: syncs, sprint plannings and retros, design
critiques, customer debriefs), each with a summary, decisions, owned action
items and a short transcript, and 13 of their action items finished as tasks.
They are ordinary meetings marked `seeded`, so the history page lists them,
search finds them, and the analytics count them like any other; the demo
cleanup never deletes them. Their dates are relative to the week the seed
runs in, and the housekeeping sweep moves them (and the samples) forward
once a week, so "the last eight weeks" are always full. Re-seeding updates
them in place.

**The shared demo board.** All guests share the seeded team's board: six
sample tasks (one deliberately overdue, three made from the sample meetings'
action items), and the history's finished tasks at the bottom of Done. A guest can move anything, add tasks and delete its own, but
cannot edit or delete the samples, remove anyone else's tasks, or change the
columns. Moves are undone later instead: once nobody has touched the board for
`DEMO_BOARD_RESET_IDLE_MIN` (60) minutes, the samples go back where the seed
put them, without comments. A guest's own tasks and comments leave with the
guest; the samples are never deleted.

**Rate limits sized for a room.** Judges on one college or office network
share an IP. Refreshing a session (every page load) and "Try Live Demo" have
their own per-IP budgets (`RATE_LIMIT_REFRESH_PER_15_MIN`, 600;
`RATE_LIMIT_DEMO_PER_15_MIN`, 60), register and sign-in keep 30, and only
*failed* sign-ins count against an account. `docs/architecture.md` has the
per-session request count behind these numbers.

To clear everything but the seed immediately before a demo (this also removes
any guest still signed in, and puts the sample tasks back):

```bash
npm run demo:cleanup -w @intellmeet/server -- 0
```

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
for anyone signed in on several devices, and for the seeded team-mate
accounts several reviewers may sign in as at once. A replay within
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

## Containers, Kubernetes and CI/CD

**Production is Vercel (client) + Render (API, built from
`server/Dockerfile`).** The same images also run as a whole stack under Docker
Compose, and on Kubernetes as the scalable path.

| What | How |
| --- | --- |
| **API image** (`server/Dockerfile`) | Node 22 Alpine, multi-stage (deps → build → fresh production install → runtime), non-root, `HEALTHCHECK` on `/api/health`, AI worker in-process (`RUN_WORKER_IN_PROCESS=true`), bundled ffmpeg checked at build time, installs with `--ignore-scripts`. Runs with a read-only root filesystem. |
| **Client image** (`client/Dockerfile`) | The Vite build on unprivileged nginx, which also proxies `/api` and `/socket.io` (WebSocket included) so the browser sees one origin, as behind the Vercel rewrite. |
| **Whole stack** | `docker compose --env-file server/.env -f docker-compose.prod.yml up -d --build`, then seed with `docker compose --env-file server/.env -f docker-compose.prod.yml run --rm server node dist/scripts/seed.js`, and open <http://localhost:8080>. |
| **Kubernetes** | `k8s/base` (Kustomize) and `helm/intellmeet` (chart): readiness on `/api/health/ready`, liveness on `/api/health`, HPA at 70% CPU, sticky WebSocket Ingress, "restricted" Pod Security, an optional separate AI worker. `k8s/local` and `values-local.yaml` run it on kind. |
| **CI** (`.github/workflows/ci.yml`) | Every PR and push to `main`: lint, Prettier, typecheck, unit tests with coverage, build, and the Playwright suite against MongoDB and Redis service containers. |
| **Images** (`.github/workflows/docker.yml`) | Push to `main`: both images to GHCR as `latest` and `sha-<commit>`. PRs build them without pushing. |

Details and the reasoning: [`docs/devops.md`](./docs/devops.md) (images,
Compose, CI, which GitHub settings matter) and
[`docs/kubernetes.md`](./docs/kubernetes.md) (manifests, chart, validation,
running on kind).

## Repository layout

```
.
├── client/                 React 19 + Vite web app (+ Dockerfile, nginx config)  → Vercel
├── server/                 Express 5 + Socket.io API (+ Dockerfile)              → Render
├── shared/                 zod schemas + types used by both
├── k8s/                    Kubernetes manifests: base + local (kind) overlay
├── helm/intellmeet/        Helm chart
├── .github/workflows/      CI and image builds
├── docs/                   architecture, DevOps, Kubernetes, API and report notes
├── docker-compose.yml      local MongoDB + Redis (development)
└── docker-compose.prod.yml the whole stack from the production images
```

## Environment variables

Nothing secret is committed. Each workspace ships a documented
`.env.example`; copy it to `.env` and fill in.

- `server/.env` — validated by zod at startup (`server/src/config/env.ts`); the
  process exits with a readable message if a variable is missing or malformed.
- `client/.env` — only `VITE_`-prefixed variables reach the browser, so they
  are **public by definition**.

### Demo-day tuning (set these on Render if needed)

Every one of these has a sensible default and is documented in
`server/.env.example`; none needs setting for a normal deployment.

| Variable | Default | What it controls |
| --- | --- | --- |
| `RATE_LIMIT_DEMO_PER_15_MIN` | 60 | "Try Live Demo" sign-ins per IP per 15 minutes (a room of judges shares one IP; each makes 1–2) |
| `RATE_LIMIT_REFRESH_PER_15_MIN` | 600 | Session refreshes per IP per 15 minutes (one per page load, one per open tab every 15 minutes) |
| `DEMO_MAX_GUESTS` | 200 | Guest accounts that may exist at once; beyond it demo sign-in answers 503 until the sweep makes room |
| `DEMO_DATA_TTL_HOURS` | 6 | Idle guests, and demo content older than this, are swept |
| `DEMO_CLEANUP_INTERVAL_MIN` | 30 | How often that sweep runs |
| `DEMO_BOARD_RESET_IDLE_MIN` | 60 | The demo board's sample tasks go back in place after this many quiet minutes |
| `LIVE_MEETING_IDLE_MIN` | 10 | A live meeting nobody is connected to is ended after this many minutes (checked every 5) |

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
- [`docs/architecture.md`](./docs/architecture.md) — how the pieces work, with diagrams
- [`docs/devops.md`](./docs/devops.md) — Docker images, Compose, CI/CD
- [`docs/kubernetes.md`](./docs/kubernetes.md) — manifests, Helm chart, validation, kind

## Roadmap

Phase 0 scaffold ✅ · Phase 1 backend foundation ✅ · Phase 2 auth/teams ✅ ·
Phase 3 meetings + Socket.io ✅ · Phase 4 frontend foundation ✅ · Phase 5 meeting room ✅ ·
Phase 6 recording + AI ✅ · Phase 7 history ✅ · Phase 8 Kanban ✅ · Phase 9 analytics ✅ ·
Phase 11 Docker/K8s/CI ✅ · Phase 12 deploy · Phase 10 quality · Phase 13
observability · Phase 14 docs & demo (Phase 11 was done before 10, so the
live demo is online early).

## License

Private / unpublished.
