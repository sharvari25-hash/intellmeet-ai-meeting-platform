# Quality report (Phase 10, updated in Phase 12)

Tests and coverage, the accessibility audit, Lighthouse scores, the bundle
analysis and the edge cases the plan lists, measured on 25 September 2026;
test counts, coverage and the live Lighthouse runs of the landing page
updated for Phase 12 on 26 September 2026. The raw local reports are in
[`quality/`](./quality/).

**Where it was measured:** in Phase 10, the production build (`vite build`,
served by `vite preview` on port 5173, which gzips like a CDN) against the
production API build (`node dist/server.js`) with local MongoDB and Redis, on
a Windows 11 laptop, headless Chrome 153, Lighthouse 13.5.0. In Phase 12,
the same Lighthouse against the live deployment (Vercel and Render); see
"Lighthouse on the live site".

## Targets and results

| Target (PROJECT_PLAN.md, Phase 10) | Result |
| --- | --- |
| Server coverage ≥ 50%, critical modules higher | ✅ 94.8% statements; auth 95.6, meetings 98.3, AI pipeline 89.4, tasks 98.2 |
| E2E: demo login → create → join → chat → end → summary → create task → move task | ✅ one test, one meeting (`e2e/recording.spec.ts`) |
| Keyboard-only walkthrough | ✅ automated (`e2e/keyboard.spec.ts`), focus visible at every stop |
| ARIA on all icon buttons | ✅ axe `button-name`: 0 violations on 24 page states |
| Colour contrast (AA), light and dark | ✅ axe: 0 violations in either theme, after 7 fixes (below) |
| `prefers-reduced-motion` | ✅ CSS, charts and (new) the board's drop animation |
| Route-level code splitting | ✅ every page but the landing page is lazy |
| Image optimisation via Cloudinary | ✅ avatars (the only images), see the caveat below |
| Bundle analysis | ✅ `npm run analyze -w @intellmeet/client` |
| Lighthouse Performance ≥ 85 | ✅ landing page: median **85** of 12 mobile runs, **99** desktop; **live: 87 mobile, 100 desktop**. ⚠️ signed-in dashboard on mobile: **64** (local; not yet measured live) |
| Initial load < 3 s | ✅ landing page LCP **1.9-2.3 s** on simulated mobile, **0.5 s** desktop |
| Edge cases: expired token, reconnect, host leaves, duplicate tabs, empty states | ✅ two bugs fixed, two behaviours added (below) |

## 1. Tests and coverage

Current (Phase 12, 26 September 2026):

| Suite | Tests | Coverage (statements / branches / functions / lines) |
| --- | --- | --- |
| Server (Vitest, Supertest, real Socket.io, in-memory MongoDB) | **555** passed | **94.81 / 86.25 / 94.83 / 94.81 %** (gate 90 / 80 / 90 / 90) |
| Client (Vitest, Testing Library) | **250** passed | **82.76 / 83.14 / 74.50 / 82.76 %** (reported, not gated) |
| End to end (Playwright, production build) | **17** passed (CI on `main`) | - |

At the end of Phase 10 they were 514 server tests (94.79 / 85.58 / 94.87 /
94.79 %) and 218 client tests. Phase 12 added 41 server tests (the client IP
helper, room-sized and per-account sign-in limits, 503 messages, the lost-job
recovery sweep, the Cloudinary URL guard and recording deletion, and the
room-code answers for somebody outside the team) and 32 client tests (the
mention caret race, and 30 for the join fix: the room page's reasons, Join
with a code, a signed-out room link through Try Live Demo, signing out, the
Invite dialog and the team page).

Critical server modules (statements / branches / functions / lines):

| Module | Files | Coverage |
| --- | --- | --- |
| auth | 4 | 95.6 / 84.9 / 100 / 95.6 % |
| meetings | 7 | 98.3 / 85.7 / 100 / 98.3 % |
| AI pipeline (`modules/ai`, `lib/ai`, `jobs`) | 19 | 89.4 / 86.2 / 87.8 / 89.4 % |
| recordings | 4 | 95.7 / 83.8 / 100 / 95.7 % |
| tasks | 12 | 98.2 / 87.0 / 98.7 / 98.2 % |
| sockets | 5 | 86.6 / 81.1 / 90.6 / 86.6 % |

Machine-readable: [`quality/coverage-summary.json`](./quality/coverage-summary.json).

**One timing failure in an earlier run.** An earlier Phase 12 client run
failed one test: `AnalyticsPage` "opens on the team you have been in
longest" waited its 5 s for the charts' heading while that file took 47 s
under coverage (29 s normally). The file alone, and the whole suite again,
passed, and so did the final run above. It is a ceiling under load, not a
race in the page; if it recurs, that one wait can be given a longer ceiling.

**The end-to-end suite** grew from 8 tests to 17: the full journey above, axe
on every page in both themes (6), the keyboard walkthrough (1), and the two
room edge cases (2). Stability, all on the production build:

| Run | Result |
| --- | --- |
| Final run of the whole suite | 17 / 17 |
| New specs, three times each | accessibility + keyboard 21 / 21; edge cases + journey 8 / 9 |
| Whole suite twice in a row | 33 / 34 |
| After the menu fix below: the journey three times, then the whole suite | 3 / 3, 17 / 17 |
| After the focus fix below, with CI's headless shell: keyboard ×3, journey ×3, whole suite | 3 / 3, 3 / 3, 17 / 17 |

The two failures are the same pre-existing flake (see "Known limitations"):
a lazy page's chunk failed to download from `vite preview` in a two-browser
test. CI retries a failed test once. Two further failures during these runs
were in the new specs themselves (a seeded meeting paginated off the first
page; a title shared by a retried run's leftovers) and are fixed.

**On CI (PR #12) the journey failed, twice,** and it was the app's fault: a
menu pressed open again within 150 ms of choosing from it stayed shut. The
closed menu is still on the page while it fades out, and it took the press
on its own button for a press outside itself. The runner reached the PDF
export 88 ms after the Markdown one; a laptop takes about a second, which is
why it never failed here. Once the menus stopped being modal, nothing held
the test back until the fade had ended. Menus now leave presses on their own
button to the button (`components/ui/dropdown-menu.tsx`), with a unit test
that presses mid-fade.

**The next run failed the keyboard walkthrough,** also the app's fault:
"Back to the dashboard" left focus nowhere. The button goes with its page,
focus fell to `<body>`, and the next Tab carried on from inside the new page
to the toasts at the end, where sonner sends focus back to where it came
from, so it never wrapped round to the sidebar. It failed only when the
dashboard had rendered before the spec looked at focus, which is why it
passed before. The app shell now puts focus on the new page's heading
whenever a navigation leaves it nowhere (`hooks/useFocusOnNavigation.ts`,
with unit tests); a screen reader announces the page, and the next Tab
starts from it.

## 2. Accessibility

### Automated checks (axe-core, WCAG 2.0/2.1 A and AA)

`e2e/a11y.spec.ts` runs axe on 24 page states, in the light theme and the
dark one: landing, sign in, sign up, invite link, 404; dashboard, the new
meeting dialog, meetings, a meeting's summary / action items / transcript /
chat tabs, the board, a task dialog, my tasks, analytics, teams, a team,
settings, the notifications menu; the lobby, the room (chat and people tabs)
and the ended screen. Each state is checked once its data has loaded.

**Before: 7 findings. After: 0 violations in 48 scans.**

| # | Finding | Where | Fix |
| --- | --- | --- | --- |
| 1 | `color-contrast` 4.34:1 (light) | inactive tabs: muted text on the muted surface | `--muted-foreground` 0.556 → 0.53 (4.84:1) |
| 2 | `color-contrast` 4.18:1 (dark) | primary text on its 10% tint over a card | dark `--primary` 0.62 → 0.67 (5.01:1; dark text on primary buttons 6.30:1) |
| 3 | `color-contrast` 2.96:1 (light) | success toast (sonner's rich colours; 4.29:1 at rest, lower while fading in) | darker toast text for all four types: 6.0-6.7:1 |
| 4 | `scrollable-region-focusable` | a transcript without a recording: a scrolling list nothing inside can focus | the list takes focus (and a name) when it has no "Play from" buttons |
| 5 | `aria-hidden-focus` | analytics donut: Recharts makes a pie focusable inside a chart hidden from screen readers | `rootTabIndex={-1}` (the chart's table carries the data) |
| 6 | `aria-hidden-focus` | the notifications menu: Radix's modal menus hide the page with `aria-hidden` but leave it focusable | dropdown menus are non-modal by default (the WAI-ARIA menu button pattern) |
| 7 | spec | (not a finding) axe measured a toast mid-fade | the spec runs with reduced motion, which also audits that path |

A contrast table of every colour pairing the UI uses (not only those on the
scanned pages) found three more, fixed the same way: destructive text on its
own 10% tint (the sign-in error box, "Recording", overdue dates) 3.99:1 →
4.73:1; success green as text 3.01:1 → 4.94:1; sonner's error, info and
warning toasts 4.35, 4.36 and 3.07:1 → 6.0-6.1:1. The amber icons beside the
STUN and mesh warnings stay: they are decorative, next to text that passes.

### Keyboard-only walkthrough

`e2e/keyboard.spec.ts` does it with no clicks: every control is reached with
Tab (or Shift+Tab when it is behind the focus), and at every stop the test
checks that a focus ring or outline is visible.

1. Tab: "Skip to content" is first; Enter, and the next Tab lands in the page.
2. "Try Live Demo" with Enter; the dashboard.
3. "New meeting" → the dialog (team already chosen) → type a title → "Start now".
4. Lobby: "Join meeting". Room: type a chat message and send it with Enter;
   the microphone toggled with Space (`aria-pressed` follows); "End for all".
5. "Back to the dashboard" → Tasks in the main navigation → "Add a task to
   To Do", type, Enter → open the new card → the Column picker (the
   keyboard way to move; dragging is the pointer way) with the arrow key → Escape.
   The card is in In Progress.
6. The theme menu: Enter opens it with focus on "Light", arrow down, Enter;
   the theme is dark and focus is back on the button.

### ARIA on icon-only buttons

All 14 `size="icon"` buttons and every bare `<button>` have an accessible name
(`aria-label` or visible text); axe's `button-name` and `link-name` rules
confirm it on every scanned page. The new controls follow suit: the host's
leave question is a labelled dialog, the "host is away" notice a status
region, the theme button on the landing page a real labelled button before
its menu has loaded.

### Reduced motion

- CSS: one rule in `index.css` makes every transition and animation instant.
- Script-driven motion, which a stylesheet cannot reach: the analytics charts
  (Recharts) and, new in this phase, the board's drop animation (dnd-kit uses
  the Web Animations API). Both read `useReducedMotion`.
- The axe spec runs with `prefers-reduced-motion: reduce`, so that path is
  exercised on every page.

## 3. Performance

### Lighthouse

Simulated throttling (Lighthouse's default): **mobile** is a mid-range phone
on slow 4G (150 ms RTT, 1.6 Mbps, CPU slowed 4x); **desktop** is 40 ms RTT,
10 Mbps, no CPU slowdown.

| Page | Runs | Performance | FCP | LCP | TBT | CLS | A11y / Best practices / SEO |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing, mobile | 12 | **median 85** (71-91) | 1.8 s | 1.9-2.3 s | 340-1,300 ms | 0 | 100 / 96 / 100 |
| Landing, desktop | 3 | **99** (98-100) | 0.4-0.5 s | 0.5 s | 20-120 ms | 0 | 100 / 96 / 100 |
| Dashboard (signed in), mobile | 3 | **64** (63-65) | 1.9 s | 3.8 s | 930-1,100 ms | 0 | 100 / 100 / - |
| Dashboard (signed in), desktop | 3 | **97** (95-98) | 0.5 s | 1.0-1.1 s | 20-60 ms | 0 | 100 / 100 / - |
| *Landing, mobile, before this phase* | 1 | *83* | *1.9 s* | *2.5 s* | *480 ms* | *0* | *100 / 96 / 91* |

The reports (HTML to open in a browser, JSON for tools) for the median runs
are in `quality/`: `lighthouse-landing-mobile`, `-landing-desktop`,
`-dashboard-mobile`, `-dashboard-desktop`, and the starting point
`lighthouse-landing-mobile-before.json`. The dashboard runs signed in with a
fresh demo guest's refresh cookie, redacted from the saved reports; each guest
was deleted after its run.

**Reading the numbers.** First and largest paint are steady from run to run.
Nearly all the spread is total blocking time, which depends on what else the
laptop was doing (a browser was in use alongside), so the landing page's
median is the fair figure and the range is shown. Best practices is 96 on the
landing page for one reason: an anonymous visitor's session check answers 401,
which Chrome logs as a console error.

### Lighthouse on the live site (Phase 12)

The same Lighthouse 13.5.0, from the same laptop with the same simulated
throttling, against <https://intellmeet-ai-meeting-platform-clie.vercel.app>
on 26 September 2026, after the production smoke test, with the API awake:

| Page | Runs | Performance | FCP | LCP | TBT | CLS | A11y / Best practices / SEO |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing, mobile | 3 | **median 87** (85-88) | 1.8-1.9 s | 1.8-2.0 s | 420-510 ms | 0 | 100 / 96 / 100 |
| Landing, desktop | 3 | **100** (100-100) | 0.4 s | 0.4 s | 10-70 ms | 0 | 100 / 96 / 100 |
| Dashboard (signed in) | - | ⏳ not measured live yet | | | | | |

**Compared with the local runs:** the landing page is slightly faster live
(mobile median 85 → 87, LCP 1.9-2.3 → 1.8-2.0 s; desktop 99 → 100). Vercel
answers the document in 20 ms from its CDN. Three runs are too few to say
anything about the spread, and blocking time is still measured on the
laptop's CPU. Best practices is 96 for
the same reason as locally: an anonymous visitor's session check answers 401,
which Chrome logs as a console error. The six reports are not in the
repository.

**The signed-in dashboard** needs a demo guest's refresh cookie, as the local
runs did; it has not been measured on the live site yet.

### What changed, and what did not work

| Change | Effect |
| --- | --- |
| Sign-in, sign-up, invite and 404 pages lazy (they were in the entry chunk) | react-hook-form out of the first download; entry 192.5 → 176.4 kB gzipped |
| `"sideEffects": false` on `@intellmeet/shared`, and the landing page's theme menu out of the entry | only the schemas the page uses are built at start-up (47 → 6 kB of the entry before minification); Radix's menu, floating-ui and focus trapping gone: 176.4 → 144.3 kB gzipped |
| The theme menu loaded on intent (hover, focus or press) | see the two tries below; this is the one that costs the first load nothing |
| `robots.txt` (the SPA fallback served HTML for it) | SEO 91 → 100 |
| Tried: loading the theme menu lazily at start-up | its 8 files delayed first paint (FCP 1.9 → 2.3 s): Lighthouse counts every request made before it |
| Tried: loading it just after the first paint | first paint recovered, but its evaluation landed in the blocking-time window (TBT 410-680 ms); replaced by loading on intent |
| Tried: preloading the dashboard's chunks alongside the session refresh | they evaluated on arrival and delayed the first render: dashboard LCP 3.6-3.7 → 3.9-4.1 s; reverted |
| Tried: starting the session refresh before React renders | it started 130 ms sooner, but the dashboard was no faster (LCP 3.7-3.9 s); reverted |

**The signed-in dashboard on mobile misses the target.** A hard reload of
`/app` fetches in a chain: the entry, then the session refresh (the route
guard waits for it), then the shell, then the page, then the page's data,
with the shell's own work (the socket client, the navigation, the menus) on
the main thread in between. Nobody gets there by a hard load in the demo:
"Try Live Demo" navigates from the landing page inside the app. On desktop
it scores 97. The fixes that would move it are structural (rendering the
shell before the session is confirmed, or server-side rendering) and belong
in a later phase.

### Bundle analysis

`npm run analyze -w @intellmeet/client` builds with
`rollup-plugin-visualizer`: a treemap ([`quality/bundle-treemap.html`](./quality/bundle-treemap.html))
and, from `client/scripts/bundle-summary.mjs`, this summary.

**First load (the landing page):**

| | Before | After |
| --- | ---: | ---: |
| Entry script, minified | 609.6 kB | 469.5 kB |
| Entry script, gzip | 192.5 kB | 144.8 kB |
| Stylesheet, gzip | 9.4 kB | 9.5 kB |
| **Total, gzip** | **202.0 kB** | **154.4 kB (-24%)** |

**What the entry script is made of now** (share of the code before
minification): react-dom 47.8%, zod 18.9%, tailwind-merge 7.5%, TanStack
Query 6.6%, React Router 6.5%, sonner 5.0%, app code 2.6%, React 1.5%, the
rest under 1% each. Removed from it this phase: react-hook-form (6.5% of the
old entry), Radix's menu and its positioning, focus and scroll-lock
dependencies (about 9%), and all but 6 kB of the shared schemas.

**What stays, and why:** zod, because the session check on every page
validates its response with the schema shared with the server (the Phase 4
decision); sonner, because its toast host must be mounted before anything
shows a toast and does not replay toasts sent earlier.

**Largest lazy chunks:** the PDF engine (444 kB gzipped, downloaded only when
somebody exports a PDF), analytics with Recharts (121 kB), the board with
dnd-kit (26 kB), the app shell (17 kB), the meeting room (14 kB).

### Images: Cloudinary transforms

Avatars are the app's only images. `AvatarImage` now asks Cloudinary for a
face-cropped square at twice the size shown (`c_fill,g_face,w_…,h_…`) in the
best format the browser takes (`f_auto`, AVIF or WebP) at an automatic
quality (`q_auto`), instead of the photo as uploaded. Any other URL is left
alone. **Caveat:** there is no avatar upload in the UI yet (the Phase 2
limitation), so no avatar in the demo is on Cloudinary today and this changes
nothing measurable until one is.

## 4. Edge cases

| Case | Before | Now | Tests |
| --- | --- | --- | --- |
| **Expired token mid-meeting** | ❌ Socket.io does not retry a handshake the server refuses; after a refresh nothing reconnected, so a room whose socket dropped after the 15-minute token expired stayed offline for good (checked against socket.io-client 4.8) | a refused handshake → refresh → reconnect with the new token; gives up after 3 refusals in a row | `client/src/lib/socket.test.ts` (5) |
| **Network drop and reconnect** | ⚠️ rejoining worked, but every failed reconnect attempt ran a session refresh; with the network down the refresh fails, and a failed refresh ends the session, so a drop long enough to fail one attempt would sign the person out (found in the code, with the library's behaviour confirmed; not seen reported) | transport failures are left to Socket.io's own backoff; no refresh | same file |
| **Host leaves** | ⚠️ the meeting carried on silently: nobody could record, mute or end it, and nobody was told | the host is asked: *End for everyone*, or *Leave, let them carry on*; everyone else sees a notice while the host is away. No host migration: the host is also who may correct the AI's minutes. An empty meeting still ends by itself | `MeetingRoom.test.tsx` (7), `e2e/room-edge-cases.spec.ts` |
| **Duplicate tabs** | ❌ two tabs of one browser were two participants who connected to each other (an echo); one tab leaving marked the person as gone | the newer tab takes over and the older one says so, with "Use this tab instead". Two *devices* (a laptop and a phone) still both join: the tabs are told apart by an id the browser keeps in localStorage. Attendance ends with a person's last device | `socket.test.ts` (3), `useMeetingRoom.test.tsx` (3), `MeetingRoom.test.tsx` (1), e2e |
| **Empty states everywhere** | ✅ already in place: dashboard, meetings (per filter and search), teams, analytics, notifications, my tasks, chat, transcript, action items, decisions, comments, chat log | unchanged | existing |

## 5. Reproduce it

```powershell
# Checks
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage -w @intellmeet/server
npm run test:coverage -w @intellmeet/client

# End to end against the production build (Docker running: docker compose up -d)
npm run build
npm run start -w @intellmeet/server                              # terminal 1
npm run preview -w @intellmeet/client -- --port 5173 --strictPort  # terminal 2
npx playwright test                                              # terminal 3
npx playwright test e2e/a11y.spec.ts e2e/keyboard.spec.ts        # the accessibility part alone

# Bundle analysis (writes client/bundle-stats/)
npm run analyze -w @intellmeet/client

# Lighthouse, with the two servers above running
npx lighthouse@13.5.0 http://localhost:5173/ --chrome-flags="--headless=new" --output=html --output=json --output-path=./lh-landing-mobile
npx lighthouse@13.5.0 http://localhost:5173/ --preset=desktop --chrome-flags="--headless=new" --output=html --output-path=./lh-landing-desktop
```

Use port 5173 for the preview: it is the origin the API allows, and on any
other port the session check is refused (403) and pollutes the results. On
Windows, Lighthouse may print an `EPERM` error while deleting its temporary
Chrome profile after the report is written; the report is fine.

## Known limitations

- **The signed-in dashboard is 64 on simulated mobile** (97 desktop); see
  above. It has not been measured on the live site yet.
- **A rare end-to-end flake, older than this phase:** twice in about 150 test
  runs, a lazy page's JavaScript failed to download from `vite preview`
  during a two-browser test ("Failed to fetch dynamically imported module").
  It did not happen in 50 targeted page loads. Chrome remembers a failed
  module download (checked), so a retry inside the app cannot recover it; CI
  retries the test once, which does, and records a trace of the failed try.
- **Lighthouse on this laptop is noisy** (blocking time 340-1,300 ms on the
  same build); the live site's numbers ("Lighthouse on the live site") are
  the reference.
- **No avatar upload yet,** so the Cloudinary transform has nothing to
  transform in the demo.
- **The keyboard walkthrough moves a task with the Column picker,** the
  keyboard route the board was designed with. Dragging with the keyboard
  (the drag handle, Space, arrows) works too but is not in the test: its
  timing is dnd-kit's.
