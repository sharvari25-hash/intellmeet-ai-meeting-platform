# IntellMeet — Build Progress Log

Running record of what was built, why it was built that way, what is known to
be missing, and what comes next. Updated at the end of every phase.

---

## Phase 8 — Team Workspace, Kanban & Tasks ✅

**Completed:** 2026-09-24

### Before Phase 8, fix 1: live meetings nobody ended stayed Live forever

**Symptom:** a meeting showed "Live" for 10+ hours. Only the host's **End for
all** ended a meeting; a closed tab, a sleeping laptop or a server restart
never does, and the demo cleanup never removes a meeting whose host is a
seeded account.

**Fix:** a meeting now records `lastActiveAt`, the last moment somebody was
known to be in its room (every join and leave, and the sweep while the room is
occupied). The housekeeping sweep (30 s after startup, then every 5 minutes)
ends any live meeting with **nobody connected** whose `lastActiveAt` is older
than `LIVE_MEETING_IDLE_MIN` (10): so 10-15 minutes after the room empties.
`endedAt` is set to `lastActiveAt`, so the history shows how long the meeting
ran, not how long it went unnoticed; open attendance is closed, the room's
Redis state cleared, the cached view evicted.

| Decision | Why |
| --- | --- |
| **"Connected" from Socket.io's room membership (`fetchSockets`), not the Redis roster** | The roster is written by leave handlers a crash never runs, so after a restart it lists everyone. Socket.io asks every instance through the Redis adapter; if one does not answer, the meeting is skipped. Unknown must never read as empty. |
| **The idle clock is a stamp, not "roster empty since"** | After a restart the sockets are gone but the stamp is at most one sweep old: a call running a minute ago is not ended while its people reconnect, and one abandoned overnight is ended by the first sweep. |
| **First check 30 s after boot** | The "on startup" check, delayed just enough for people who were mid-call to reconnect and rejoin first. |
| **Conditional update** (`status: live` and the same `lastActiveAt`) | A join landing between the check and the write keeps the meeting open; several instances sweeping end it once. |
| **One scheduler, `jobs/housekeeping.ts`** | The demo cleanup's timer moved there. The quick jobs (this, the demo board reset) run every 5 minutes; the demo cleanup keeps its 30. |

**Found while building it (bug 1 below):** the room page never rejoined its
room after a socket reconnect. That is the restart case exactly: people stayed
in a working peer-to-peer call while the server thought the room was empty,
with no chat or signalling, and the new sweep would have ended the meeting
under them. Fixed as part of this: the page rejoins on every reconnect and
rebuilds its mesh, and every join first removes roster entries whose socket is
gone and tells the room (`sockets/rooms.ts`), so nobody offers to a peer that
died in the restart. The sweep prunes such ghosts from occupied rooms too.

**Tests (13 + 1):** ended at the idle limit and dated to when it emptied (with
the cache evicted); ended whoever hosts it, the seeded persona included;
started-but-never-joined; a room that just emptied is kept; a call running
when the server restarted is kept while people reconnect; an occupied meeting
is kept however old, with its clock refreshed; never ended when an instance
does not answer; nothing without a socket server; scheduled and ended meetings
untouched; the clock is stamped on join and leave; ghosts are dropped before a
newcomer gets the roster, announced as left, a dead recorder stops the
indicator; occupied rooms are pruned by the sweep. Client: the room joins
again after a reconnect and rebuilds its transport.

### Before Phase 8, fix 2: rate limits for a room of judges on one network

**Assessment: the risk was real.** Counted from the client code, one demo
session costs: 1 refresh per full page load (the landing page included, since
the access token lives in memory), 1 demo sign-in, +1 refresh per reload, new
tab or pasted link, +1 per open tab each 15 minutes, and a second private
window (to meet yourself in a call) adds another refresh and demo sign-in.
Twenty minutes with two windows and a couple of reloads is about **nine**. The
old budget, 30 per IP per 15 minutes shared by register, sign-in, refresh and
demo, ran out at the **fourth** judge on one network; a class of twenty opening
the link at once would have hit it in the first minute. The failure was ugly:
"Too many requests" on the landing page, or, on a reload, looking signed out
(a failed refresh reads as "no session"). The seeded-account path was also
tight: five judges signing in as Ada from one network locked out the sixth,
because the per-account limiter counted successful sign-ins.

**Choice:** separate budgets by what each endpoint risks.

| Limiter | Key | Budget |
| --- | --- | --- |
| Refresh | IP | 600 / 15 min (`RATE_LIMIT_REFRESH_PER_15_MIN`): about 60 people's worth |
| Demo sign-in | IP | 60 / 15 min (`RATE_LIMIT_DEMO_PER_15_MIN`): 30 people with two windows |
| Register + sign-in | IP | 30 / 15 min, unchanged: each hashes a password (bcrypt ~350 ms of CPU) |
| Failed sign-in | IP + email | 5 / 15 min, now **failures only** |
| Board edits (new) | account | 120 / min, so a room dragging cards does not share one budget |

- **Refresh stays per IP, generously**, rather than keyed on the session: the
  token rotates on every call, so its only stable key (the family id) is known
  only after the database lookup the limiter protects, and keying on the raw
  cookie would give every forged value its own bucket. There is nothing to
  guess in a 256-bit token, so a high ceiling only has to stop a runaway
  client or a flood.
- **Demo stays bounded twice**: 60 per address, and `DEMO_MAX_GUESTS` (200)
  for everyone. The trade-off: one address could use up to 60 of the 200 guest
  slots in 15 minutes. A deployment facing abuse would put a CAPTCHA on "Try
  Live Demo"; both numbers are environment variables for demo day.

**Tests:** 45 page loads from one address are never rate limited; the refresh
limit still applies (lowered via env); 35 demo sign-ins from one address
succeed without using the register budget; the demo limit still applies; 8
successful sign-ins to one account pass, and 5 failures still lock it.

### Polish

The avatar menu's guest hint ("Demo guest - rename yourself in Settings") was
truncated in the 15rem menu. It now wraps; a real account's email still
truncates on one line. Checked at 360 px.

### Built

- **Boards per team.** Every team gets a default board on first use (To Do /
  In Progress / Review / Done); admins can create more. Columns are added,
  renamed, reordered (move left / right), marked as "counts as done" and
  removed when empty, by a team admin.
- **Tasks:** title, description, assignee (team members only), due date,
  priority, the column, and a link back to the meeting and action item they
  came from. Comments with @mentions. Delete with confirmation.
- **Drag and drop (dnd-kit)** within and across columns: mouse (after 6 px),
  touch (after a short press, so a swipe still scrolls) and keyboard (Space on
  the card's grip, arrows, Space). Screen readers hear task and column names,
  never ids. The task's **Column** picker is a second way to move without a
  mouse.
- **Fractional ordering and optimistic moves:** a drop is sent as the two
  cards it landed between; one document is written; the card moves at once
  and goes back with an explanation if the server refuses.
- **Real-time sync:** board rooms (`board:<id>`), events for created, updated,
  moved, deleted and commented tasks, and a "reload" event for column changes.
  Every task has a `version`, so late or duplicate events never overwrite a
  newer state. Two different guests in two windows see each other's cards
  appear, move and gather comments.
- **"Create task" on the meeting page is real:** per item, or **Create tasks
  for all**, in a dialog with each owner pre-filled from the AI's match (and a
  note when the AI heard a name that belongs to nobody) and the due date
  pre-filled too. Items with a task show its column live ("In Progress") and
  link to it. Uses the stable action-item ids from Phase 7; legacy items get
  real ids on first use.
- **@mentions** in meeting chat and task comments: type `@`, pick from the
  team, and the person gets a notification (live, and in the bell) that links
  to the meeting's chat or the task. Mentions are highlighted where they
  appear.
- **Assignment notifications** (`task_assigned`) when someone else gives you a
  task.
- **My Tasks:** everything assigned to you across boards and teams, grouped
  Overdue / Coming up / No due date / Done. Overdue is highlighted there and
  on the board (a task in a "done" column is never overdue).
- **The seeded demo board:** six sample tasks across all four columns, one
  deliberately overdue, three made from the sample meetings' action items
  (so those items already say "In Progress", "Review", "Done").

### The shared demo board: what judges may and may not do

All judges are guest members of one seeded team, so they share its board. The
general permission rule (`taskPermissions`, shared by server and client)
already keeps one judge from breaking it for the next:

| A guest (plain member) can | A guest cannot |
| --- | --- |
| Move any card, samples included | Edit or delete a sample task (admins only; no guest is one) |
| Create tasks; edit and delete **their own** | Delete another judge's task |
| Comment and @mention on any task | Add, rename, reorder or remove columns, or boards |
| Turn a sample meeting's action items into tasks | Grow the board past 300 tasks |

Moves are the point of a board, so they are allowed and **undone later**: once
the demo board has been quiet (nothing created, edited, moved or commented)
for `DEMO_BOARD_RESET_IDLE_MIN` (60), the sweep re-runs the seed for the board.
The samples go back to their columns with fresh relative due dates and without
comments; columns go back to the defaults. A board in use is never reset under
anyone. `npm run demo:cleanup -w @intellmeet/server -- 0` also resets it at
once.

Cleanup: a guest's tasks and comments go with the guest (end of session or the
idle sweep); tasks somebody else gave a guest stay, unassigned; an action item
whose task goes offers "Create task" again. **Seeded tasks are never deleted**:
`deleteTasksWhere` excludes them unless a whole board is deleted, and the
seeded board belongs to the seeded team, which nothing deletes. A mutation
check confirmed the test notices: with the exclusion removed, "never removes
the samples, even when asked to sweep everything" fails.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Moves as neighbours (`afterId`/`beforeId`), not an index or a number** | The server computes the order from its own copy of the neighbours, so a client with a slightly stale board still lands the card where the person dropped it, and cannot write an arbitrary order. |
| **Fractional `order`, renumbered only when the gap runs out** | A move writes one document instead of shifting every card below it. After ~30 drops into one slot the column is renumbered in steps of 1024 and the renumbered cards travel with the move event. |
| **The same `orderBetween` on both sides** | The optimistic position is the one the server will store, so nothing jumps when the answer arrives. |
| **A `version` per task** | Socket events and HTTP answers can arrive in any order; the client keeps the highest version. It also makes the sender's own echo harmless, so the server needs no "which socket sent this". |
| **Events patch the cache; broad changes ask for a reload** | A drag in another window is one small event. Column changes, a reset or a guest leaving are rare and reshape the board, so viewers refetch. |
| **Board rooms, joined per page, membership checked on join** | Only people looking at a board get its events (the demo team can have 200 guests); a board id is never a capability on its own. |
| **Columns and boards are admin-only; cards are everyone's** | Columns are the team's workflow and shared by everybody; cards are day-to-day work. It is also exactly what keeps judges from breaking the shared board. |
| **Delete: creator or admin; edit: any member except samples** | Collaborative editing is normal on a board; deleting someone else's work is not a member's call. |
| **"Done" is a column flag, not "the last column"** | Renaming or reordering columns never silently changes what counts as finished. |
| **Action item status is not synced to its task's column** | The minutes are the host's; the item shows its task's column live instead ("In Progress"), which says more than a tick. The seeded "Done" sample's item is marked done at seed time for consistency. |
| **Any team member can turn items into tasks** | Filing the tasks is often not the host's job. On the shared samples, a guest's tasks go with the guest, which frees the items for the next judge. |
| **Unique index on (meeting, action item)** | A double click, or two people pressing at once, makes one task; the other request reports the item as skipped. Tested with two parallel requests. |
| **Plain-text mentions (`@Grace Hopper`, `@Grace` when unique)** | Nothing to render specially anywhere (chat log, exports, notifications); the server and the page share one parser, so the highlighted names are the notified ones. An ambiguous first name notifies nobody, like the AI owner matching. |
| **Comments in their own collection** | A busy discussion would otherwise grow the task document every board load reads; counts are aggregated per board load. |
| **Default board created lazily, guarded by a partial unique index** | Every team that existed before boards gets one, and concurrent first visits create exactly one (tested with five in parallel). |
| **Stable ids for seeded columns, tasks and sample action items** | Re-seeding (a deploy, a reset) updates instead of duplicating and never breaks a link, including links judges made to sample items. |
| **Sample due dates relative to the seed** | The sample meetings are a week or two old; copying their items' deadlines made three of five open samples overdue. Now exactly one is, on purpose. |
| **dnd-kit with separate grip and title controls** | Mouse and touch drag from anywhere on the card; the keyboard drag lives on the grip, so Enter on the title opens the task instead of picking it up. |
| **Services never emit; controllers call `task.events.ts`** | The socket layer imports the board service (to check who may watch), so the services reaching back into the socket layer would be a real import cycle. |

### Bugs found while building

1. **The room never rejoined after a socket reconnect** (see fix 1). After a
   server restart people kept a peer-to-peer call the server no longer knew
   about: no chat, no signalling, and no way back without reloading.
2. **Every `npm run seed` gave the sample meetings' action items new random
   ids.** The seed replaced the item array wholesale, so any task linked to a
   sample item would have lost its link on the next seed or deploy. The ids
   are now derived from the fixture and item index, and existing task links
   are carried over.
3. **The board made the whole page 1000 px wide at 360 px**, found by the 360
   px check. Screen-reader-only labels are absolutely positioned, and with no
   positioned ancestor the ones in off-screen columns escaped the board's
   horizontal scroller. The scroller is now the containing block.
4. **The first visit to /app/tasks reloaded the dev page mid-navigation**,
   found by the e2e run. dnd-kit is only reachable through the lazy task page,
   so Vite's start-up scan missed it and re-bundled on first use. It is now
   pre-bundled (`optimizeDeps.include`). Development only.
5. **Comments on the shared samples survived a reset, and commenting did not
   count as using the board**, found in review. A reset could have landed
   mid-conversation. Both fixed and tested.

### Known limitations

- **Columns move with buttons (left / right), not by dragging.** Cards drag.
- **After a reconnect the mesh is rebuilt**, so video blinks for a second, and
  a screen share has to be started again.
- **No editing or deleting a single comment**; comments go with their task (or
  their guest).
- **Concurrent edits to one task: last write wins.** Versions order events;
  they do not merge two people's edits to the same field.
- **A board is loaded whole** (capped at 300 tasks), with no pagination.
- **My Tasks is not live**: it reloads on each visit and when you are assigned
  something.
- **A meeting whose people sit in the lobby (not joined) for 10+ minutes is
  ended**, since "connected" means in the room.
- **Touch drag was checked by design and at 360 px, not on a real phone.** The
  e2e drag uses the mouse.
- **Mention suggestions list up to six people** matching the start of a name;
  in the demo team (up to 200 guests) typing more letters narrows them.
- **Test-run notes:** three targeted `npx playwright test e2e/board.spec.ts`
  runs ended with Node's `UV_HANDLE_CLOSING` assertion *after* all tests had
  passed (exit code 9). It did not occur in the full `npm run test:e2e` runs,
  which exited 0. And one "not wrapped in act" warning appears only in the
  full parallel client run; no test file produces it on its own.

### Manual test script (two windows)

Prerequisites: `docker compose up -d`, **`npm run seed -w @intellmeet/server`
(re-run it: it adds the board and stable action-item ids)**, `npm run dev`.

1. Window 1 (normal) <http://localhost:5173> → **Try Live Demo** → **Tasks**.
   Six sample tasks; *Triage the accessibility audit findings* says
   **Overdue**.
2. Window 2 (private window) → **Try Live Demo** → **Tasks**. A different name
   in the account menu.
3. Window 1: **Add a task** under To Do, type a title, Enter. It appears in
   window 2 at once.
4. Window 1: drag it to **In Progress**. It moves in window 2. Reload window
   2: still there.
5. Window 2: open that task. No **Delete task** (not theirs). In **Add a
   comment** type `@` and the first letters of window 1's name, pick it, add
   a few words, **Comment**. Window 1: the card shows the comment count, the
   bell lights up; pick the notification and the task opens.
6. Window 2: open *Triage the accessibility audit findings*: read-only, with
   the sample note. Change **Column** to Done: it moves in window 1. Try to
   edit it with the API (below): 403.
7. Window 1: **Meetings** → *Sprint 14 planning* → **Action items**. *Fix the
   recording upload retry bug* already shows **In Progress** (seeded). Press
   **Create tasks for all (3)**: owners and dates are filled in from the AI.
   **Create 3 tasks**. The items now show **To Do** and link to their tasks;
   window 2's board shows them live.
8. Window 1: open one of them, set **Assignee** to yourself and **Due date**
   to yesterday, **Save changes**. **Tasks → My tasks**: it is under
   **Overdue**.
9. In a live meeting, type `@` in the chat to mention someone who is not in
   the room; they get a notification linking to the chat.
10. Stale meetings: start a meeting, join, close the tab. Within 10-15 minutes
    the dashboard shows it ended (`LIVE_MEETING_IDLE_MIN=1` in `server/.env`
    shows it within 1-6 minutes).
11. Both windows: account menu → **End demo session**. Their tasks and
    comments leave the board; the items they filed offer **Create task**
    again; the samples stay.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **587 passed** (416 server, 171 client) |
| `npm run test:e2e` | ✅ **7 passed**, twice: two guests on one board (create, drag, live move, comment + mention), action item → task, demo identity, history, mesh, controls, record → AI |
| Server coverage | ✅ **93.2% statements**, 84.0% branches (Phase 7: 91.9% / 83.1%) |
| Horizontal overflow at 360px | ✅ none: board, task dialog, My Tasks, action items, create-tasks dialog |
| `npm run build` | ✅ all 3 workspaces; the task page is its own lazy chunk (82 kB, 27 kB gzipped, dnd-kit included) |
| e2e cleanup | ✅ database compared before and after: same guests (the 2 that were there), 6 tasks (all seeded, at their seeded positions, version 1), 3 action-item links (the seeded ones), 0 comments, same notifications and messages |

The e2e runs used the running dev servers (the API had reloaded the new code:
the new routes answered 401, not 404).

### Next phase

**Phase 9 — Analytics & Insights:** aggregation endpoints (meetings per week,
durations, participants, action items created vs completed, task completion
per member, most active members) cached in Redis, a Recharts dashboard with a
date range and team filter, and CSV export. The tasks and their links to
meetings now give the "completed" side real data.

---

## Phase 7 — Post-Meeting Dashboard & History ✅

**Completed:** 2026-09-24

### Before Phase 7: every demo sign-in is now a different person

**Symptom:** every "Try Live Demo" signed into the same seeded Demo User. Two
windows, or two reviewers, were one person: both were host of each other's
meetings (either could press **End for all** on the other), the participant
list showed "Demo User" twice, and the AI gave every action item to "Demo
User".

**Options considered.**

| Option | Verdict |
| --- | --- |
| Keep one account, make "host" per-session | Host, ownership, notifications and AI owners are all keyed on the user id. Faking separate people inside one account would touch every one of them and still leave the AI unable to tell anyone apart. |
| A pool of pre-seeded demo accounts, handed out in turn | Needs a lease and a release, and still collides once more reviewers arrive than there are accounts. |
| **A new guest account per sign-in** | Chosen. |

**Design.** `POST /api/auth/demo` now creates a guest (`authProvider:
'guest'`) and signs in as it:

- **Friendly generated name**, colour plus animal ("Amber Otter"). Colours
  double as plausible first names, which matters because the AI addresses
  people by first name and owners are matched back by those names. A new name
  never shares a word with anyone already in the team: "Amber Otter" and
  "Amber Heron" together would make "Amber will do it" a tie, and a tie is
  assigned to *nobody*.
- **A member of the seeded demo team**, so the sample meetings are visible
  immediately, and a plain *member*: it can hold, record and end its own
  meetings, but cannot remove the seeded team-mates, promote itself, or edit
  the sample meetings (their host is the seeded Demo User).
- **No password** and an address under the reserved `.invalid` domain: the
  session it starts is the only way in, and nothing can ever be emailed to it.
- **Removed by the existing demo cleanup** once it has been idle for
  `DEMO_DATA_TTL_HOURS` (6). *Idle*, not *old*: every sign-in and token refresh
  pushes a refresh token stamped with its creation time, and an active tab
  refreshes at least every 15 minutes, so "no token newer than the cutoff" is
  "has done nothing since". A reviewer still clicking after six hours is left
  alone. Removal takes everything only the guest could manage: meetings it
  hosted (whatever their age; nobody could ever end or delete them again),
  teams it owned, its notifications, and its place in the team's member list.
  Meetings it only attended stay with their host.
- **`DELETE /api/auth/demo`** ends a guest's session now instead of waiting:
  the account menu offers **End demo session** to guests (with a
  confirmation), and the e2e suite uses it to clean up. Real accounts get a
  403; deleting those is a different feature.
- **A ceiling** (`DEMO_MAX_GUESTS`, 200): the endpoint is public and creates
  an account, so the rate limiter bounds one IP and the ceiling bounds
  everyone. At the ceiling a demo sign-in gets a 503 until the sweep has made
  room.

**Tests:** every sign-in is a different, friendly-named guest; guests are
plain members who see the samples; a second guest gets 403 on the first's
"end for all"; six guests share no name word; no password sign-in; the
ceiling; `DELETE` removes the guest, its meetings and membership and kills the
cookie, and refuses real accounts; the sweep removes idle guests with their
data, keeps active and brand-new ones, removes signed-out ones, never touches
the seeded persona or a real account; the account menu's confirm flow; and a
new e2e spec, two browsers pressing "Try Live Demo" and meeting each other,
where only one sees **End for all**. The session-family tests that used to run
on the shared demo account now run on a normal account signed in several
times, which is the case they actually protect.

**E2E cleanup.** `signInAsDemo` records each guest the moment the server
answers (in a per-run file that global setup hands to the workers), and global
teardown ends each guest's session, which deletes the meetings it hosted. A
run now leaves the workspace exactly as it found it; verified against the
local database after every run in this phase.

### Built

- **Meeting history** (`/app/meetings`): All / Upcoming / Live / Past filters
  (each in its natural order: upcoming soonest first, past most recently
  ended first), a team picker for people in more than one team, pagination,
  and search. All of it lives in the URL, so a search survives a reload and
  can be shared.
- **Search across titles, summaries and transcripts**, on the three text
  indexes Phase 6 created (Meeting, MeetingInsight, Transcript). Results are
  ranked by relevance, and each row says *why* it matched: the summary
  sentence, the decision, or the transcript line with its timestamp, with the
  searched words marked. A transcript match links straight to that moment.
- **History rows** show the start of the summary and what the meeting
  produced ("2 decisions · 4 action items, 3 open"), which is what tells one
  weekly sync from the next.
- **The meeting page, grown into tabs:** Summary (with key decisions), Action
  items, Transcript, Chat, Recording. The open tab is in the URL
  (`?tab=transcript&t=252&q=pricing`).
  - **Transcript:** searchable (filters to matching lines and highlights),
    and with a recording every timestamp is a **Play from** button that seeks
    the audio. The line being played is highlighted.
  - **Chat log:** the meeting's chat, oldest first, with "Load earlier
    messages" on the existing cursor.
  - **Recording:** the audio, with a download link.
  - **Action items:** a "Create task" button per item, disabled and explained
    until the task board exists in Phase 8.
- **Host editing of the AI output** (`PATCH /api/meetings/:id/insight`):
  the summary, the decisions, and each action item's text, owner, due date and
  done state, plus adding, removing and reordering items. Ticking an item off
  is one click. Edited output says so ("Edited by … on …").
- **Export:** Copy summary (plain text with bullets, ready for chat),
  Markdown (with a GitHub task list and a timestamped transcript) and PDF
  (`@react-pdf/renderer`, built in the browser, loaded only when asked for).
- **Seeded meetings show up well:** each sample meeting now has a short chat
  log, and its action items have stable ids.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Query the three text indexes and merge, rather than one combined index** | MongoDB allows one text index per collection, and the text lives in three. A denormalised "search document" would need keeping in sync with three writers (the meeting, the AI pipeline and host edits). Three indexed queries in parallel are cheap at this scale. |
| **Insight and transcript searches are scoped to the caller's meeting ids** | Those collections span every tenant. Searching them unscoped and filtering afterwards would rank other teams' meetings and could push the caller's out of the candidate limit. The next step at scale is `teamId` on both, prefixing their text indexes. |
| **Weighted merge: title ×3, summary/decisions ×2, transcript ×1** | Mongo's text scores are only comparable within one index, so the weights are a judgement: a word in the title is the strongest sign a meeting is about it. Ties fall back to recency, so pages never overlap. |
| **The server says why each meeting matched** | Mongo reports *that* a document matched, not *where*. The server re-finds the words in the page's rows only (summary first, transcripts only for rows nothing else explained, since they are the largest documents). |
| **One term reader, shared by server and client** (`shared/src/search.ts`) | The snippet the server picks and the words the client highlights must agree. Mongo stems ("planning" matches "we planned"), so both use the same small approximation: strip a suffix, match words starting with what is left. |
| **List rows carry a summary preview, loaded with one query per page** | The history is only useful if rows can be told apart. Building the page's meeting views now also loads every host and participant in one `$in`, rather than one query per row. |
| **Edits replace whole lists** | The form holds the full list anyway, and "replace" has no merge or ordering semantics to get wrong. |
| **Action items got stable ids** | So an edit can say which item it changes, and a Phase 8 task can point at the item it came from even after the host rewords the list. A kept item keeps its task link; an id the client made up can never adopt another item's task. |
| **Owners must be members of the meeting's team; names come from the account** | They must be able to see the meeting their task came from, and a client cannot relabel somebody. An owner the item already had is let through even if they have since left, so an unrelated edit does not fail on them. |
| **Editing is host-only, and refused while the AI is running** | The host is accountable for the minutes, and the pipeline is about to overwrite the insight. A fresh AI run clears the "edited" marker along with the edits. |
| **Guests cannot edit the sample meetings** | They are shared by every reviewer. To try editing, record a short meeting of your own (the mock AI answers in seconds). The page tells a non-host who can edit, instead of leaving them looking for a button. |
| **Recording player is the browser's `<audio>`, not Cloudinary's player** | Recordings are audio only; the native player is accessible with no extra script. A Cloudinary URL plays directly; a locally stored one is fetched with the bearer token and played from an object URL, because the token must never go in a URL. |
| **Exports are built in the browser** | No server-side renderer on Render's free tier, nothing leaves the device, and the page already holds all the data. |
| **The PDF engine is its own lazy chunk** | 455 kB gzipped. Nobody downloads it until they press PDF; the meeting page chunk is 11 kB. |
| **PDF uses the built-in Helvetica** | No font download. The cost is Windows-1252 characters only: accents are transliterated and anything else becomes "?". Markdown keeps every character. |
| **URL state for filters, search, page and tab** | Back and reload work, and a search result can deep-link into a transcript. |

### Bugs found while building

1. **Recordings stored without Cloudinary could never be played back.**
   `GET /api/meetings/:id/recording/audio` answered 500 for every local
   recording. `res.sendFile` refuses any path containing a dot-segment, and
   the default directory is `server/.data/recordings`. Phase 6's test passed
   only because the suite kept recordings in a temp directory without a dot;
   nothing in the UI played audio until now. Fixed by serving the file name
   under `root` (only the name, already pinned to `<meetingId>-<ts>.<ext>`, is
   checked). The test setup now stores recordings under a `.data` directory
   like the real default, which reproduced the 500 before the fix. A file that
   has gone (Render wipes its disk on deploy) now answers 404 rather than 500,
   with a JSON body labelled as JSON rather than as audio.
2. **Legacy action items got a new random id on every read.** Mongoose
   invents an `_id` for an array subdocument stored without one, differently
   each time it hydrates it (verified in a scratch database). Insights are now
   read `lean`; items stored before ids existed get a positional `legacy-N`
   id until their first edit writes real ones. Re-running the seed gives the
   sample meetings real ids.
3. **react-pdf: four layout faults, found by exporting and looking at the
   file.** A `fixed` footer View was never drawn (a `fixed` Text is); page
   numbers through the `render` prop are never painted in 4.9, even in the
   documented form, so they were dropped; names were hyphenated ("Alan
   Tur-ing"); and a transcript line could split from its timestamp across a
   page break (`wrap={false}` per line).
4. **`highlight.ts` beside `Highlight.tsx`** would have been one file on
   Windows' case-insensitive filesystem, with `./Highlight` resolving to the
   `.ts`. Renamed to `textMatch.ts` before it bit.

### Known limitations

- **No page numbers in the PDF** (see bug 3). The meeting title repeats on
  every page instead.
- **PDF text is Western European only** (built-in fonts). Markdown export and
  the page itself handle any script.
- **Search reads up to 200 candidates per index** and fetches the ids of every
  meeting in the caller's teams to scope the insight and transcript queries.
  Fine for thousands of meetings; the scaling step is noted above.
- **Snippets use a stemming approximation.** When Mongo's stemmer matches a
  form the approximation does not, the row simply has no snippet.
- **Edits are not pushed live.** Other people viewing the page see a
  correction on their next load. A new recording of the same meeting replaces
  the AI output, corrections included.
- **The sample meetings have no audio**, so click-to-seek can only be tried on
  a meeting you record. Their transcripts are still searchable and
  timestamped.
- **Transcripts are not editable**; the design review in the samples parks the
  same question.
- **"Create task" is disabled until Phase 8.** *(Phase 8: done.)*
- **Two tabs of one browser profile share the refresh cookie**, so a second
  "Try Live Demo" in the same profile replaces the first guest in both tabs at
  the next token refresh. The landing page says to use a private window.
- **The e2e suite uses ~20 of the 30 auth requests** one IP may make in 15
  minutes (every page load refreshes the session). Global setup resets the
  counters; manual sign-ins alongside a run can still exhaust them. *(Phase 8:
  refresh and demo sign-in have their own, much larger budgets.)*
- **Six orphaned chat messages** from Phase 6 e2e runs (23 Sep, before this
  phase) remain in the local database; their meetings were deleted before the
  cascade existed. Harmless; not created by this phase.

### Manual test script

Prerequisites: `docker compose up -d`, `npm run seed -w @intellmeet/server`
(**re-run it once**: it adds the sample chat and action-item ids), `npm run dev`.

1. <http://localhost:5173> → **Try Live Demo**. The account menu shows a
   generated name ("Amber Otter") and "Demo guest".
2. **Meetings** in the sidebar. Type `pricing`: *Q3 launch retrospective*,
   with the summary sentence and "pricing" marked. Press **Upcoming**: nothing
   matches; **Past**: it is back.
3. Search `interviews`: the design review, with **Transcript 00:30** and a
   **Jump to 00:30** link. Follow it: the Transcript tab opens with the line
   highlighted and the search filled in. Open **Chat**: the sample chat.
4. **Summary** tab: no Edit button, and a note that only Demo User (the
   sample's host) can correct it. **Copy summary** and paste somewhere;
   **Export → Markdown** and **Export → PDF** download files that open.
5. Private window: **Try Live Demo** again. It is a different name. Window 1:
   **New meeting** → **Start now** → **Join**; copy the invite link into window
   2 and join. Only window 1 has **Record**, **Mute all** and **End for all**.
6. Window 1: **Record** for ten seconds, **Stop recording**, **End for all** →
   **Summary and action items**. When the summary appears (mock AI, seconds):
   **Edit summary**, change it, **Save changes** → "Edited by …". **Action
   items**: tick one off; **Edit action items** to reassign one, date it, add
   one. **Transcript**: press a timestamp and the recording plays from there.
7. Window 2 reloads the meeting page and sees the corrected summary.
8. Account menu → **End demo session** → confirm. The guest and its meeting
   are gone; the sample meetings are untouched.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **476 passed** (329 server, 147 client) |
| `npm run test:e2e` | ✅ **5 passed**, twice in a row: demo identity, history search + export, mesh, controls, record → AI → edit → export |
| Server coverage | ✅ **91.9% statements**, 83.1% branches |
| Exported PDFs | ✅ opened and read: one-page (recorded) and two-page (sample) |
| Horizontal overflow at 360px | ✅ none: history, and every meeting tab |
| `npm run build` | ✅ all 3 workspaces; PDF engine in its own lazy chunk |

The e2e runs used a temporary API (port 5100) and client (port 5190) started
for the purpose and stopped afterwards: the `tsx watch` in the running dev
terminals had stopped reloading (no restart for any edit after 06:35), so the
API on port 5000 was serving stale code. Its terminals were left alone.

### Next phase

**Phase 8 — Team Workspace, Kanban & Tasks:** boards per team, task CRUD,
drag and drop with fractional ordering and live board sync, and the "Create
task" button this phase left disabled, turning an action item (by its new
stable id) into a task with the owner pre-filled.

---

## Phase 6 — Recording & AI Meeting Intelligence ✅

**Completed:** 2026-09-24

### Phase 5 follow-up: the remote tile stayed grey for ~30 seconds

**Symptom (manual test, two windows on one PC):** both windows showed *2 in
the room* and chat worked, but the remote tile was a blank grey box for 30+
seconds before video appeared.

There were two problems: one cosmetic, and a real connection bug underneath it.

**1. The tile showed an empty `<video>`.** `ontrack` fires when the remote
offer is *applied*, long before ICE connects or a frame is decoded. The tile
treated "has a stream" as "has video", hid its spinner and revealed an element
with nothing in it: the grey box. The tile now reveals the video only once
`videoWidth > 0` (the first decoded frame) and shows a visible **Connecting…**
until then. Once frames have arrived, a later drop keeps the last picture and
shows the reconnecting icon instead of flashing back to "Connecting…".

**2. Roughly one join in six never connected at all.** Measured rather than
guessed: a throwaway Playwright probe wrapped `RTCPeerConnection` in both
browsers and logged every signalling state, ICE state and candidate, joining
the same room repeatedly.

| Configuration | Joins | Stalled |
| --- | --- | --- |
| Before the fix | 21 | **3** (plus 3 of 15 with the candidate pool disabled) |
| After the fix | 15 probes + 10 e2e runs | **0** |

A stalled join looked like this in the log: both sides reached `stable`, the
polite side had rolled back its own offer to accept the other's, and then
**never gathered a single ICE candidate for its answer**. With no candidates,
ICE never started, so it never reached `failed`. That meant the
ICE-restart-on-failure recovery never fired, and the call sat blank
indefinitely.

The root cause was ours, not the browser's. `MeshTransport` had *both* peers
add their tracks the instant they learned about each other, so **every single
join was a guaranteed offer collision**. Perfect negotiation resolves a
collision correctly on paper, but it resolves it with a rollback, and Chrome
intermittently fails to gather for the answer that follows a rollback made
before its first candidate. Disabling the ICE candidate pool (the first
suspect) did not help: 3 stalls in 15.

**Why it eventually "worked" after ~30s:** almost certainly a *second* bug. The
room hook listed `onForceMute` as an effect dependency, and `MeetingRoom`
built that callback from the media object, which is new on every render of
the page. So toggling the microphone or camera made the room **leave and
rejoin**, tearing down every peer connection. That rebuild is what unstuck
the stalled connection. Confirmed in the probe: one mic toggle produced a
`closed` connection plus a brand-new one.

**Fixes:**

| Fix | Why |
| --- | --- |
| **The newcomer offers; people already in the room wait for its offer** | Removes the collision from every join, so nothing is rolled back. Existing members create the connection on `room:user-joined` but hold their tracks back (`awaitingOffer`) and attach them to the offered transceivers when the offer arrives, so one round trip suffices. Perfect negotiation stays for later renegotiations. A newcomer with no camera or mic still offers, using receive-only transceivers. |
| **A connection watchdog** | Belt and braces for any future stall: if a peer is still in `new` after 5s, a member still waiting for an offer stops waiting and offers itself, and otherwise the impolite side calls `restartIce()`, which forces fresh gathering on both ends. Up to three attempts, then a "Could not connect" toast. `connecting` (checks in progress) is left alone. |
| **`onForceMute` read through a ref** | A toggle no longer rejoins the room. |
| **Tile waits for the first frame** | See above. |

**Tests that would have caught it:**

- The Playwright spec now wraps `RTCPeerConnection` with an init script and
  asserts, in both browsers, that the live connection reaches `connected` and
  that every remote `<video>` has `videoWidth > 0`, within 4.5s. That budget is
  deliberately below the 5s watchdog, so a stall rescued by the watchdog still
  fails the test. It also toggles the mic and asserts there is still exactly
  one peer connection.
- **Mutation check:** with the *old* `MeshTransport` restored, the new spec
  failed 2 of 6 runs; the old spec had never failed. With the fix it passed
  10 of 10.
- Unit tests: who holds tracks and who offers, receive-only transceivers
  without media, all watchdog paths (timing, impolite-only, cancelled on
  connect or leave, gives up after three), the tile's states, and a hook test
  proving a new `onForceMute` identity does not emit `room:leave` or a second
  `room:join`.

### Built

- **Recording (host only).** `MeetingRecorder` mixes the host's microphone and
  every remote peer into one Web Audio graph and records it with
  `MediaRecorder` (Opus, 32 kbps, 10s timeslices). Sources are added and
  removed as people join and leave mid-recording.
- **Recording indicator for everyone**, over `recording:state` (host only on
  the server), carried on the roster so a late joiner sees it too, and cleared
  if the recording tab disappears.
- **Two upload paths, chosen by the server** (`GET
  /api/meetings/:id/recording/upload-target`):
  - Cloudinary configured: a signed direct upload from the browser, then
    `POST /api/meetings/:id/recording`. The URL is pinned to our own cloud and
    recordings folder, because the worker downloads it (an SSRF guard).
  - No Cloudinary: `PUT /api/meetings/:id/recording/file` with the raw audio,
    stored under `server/.data/recordings`. **This is why the whole flow works
    today with no accounts.**
- **The `process-meeting` BullMQ job**, with the worker in-process
  (`RUN_WORKER_IN_PROCESS=true`) and a standalone `npm run worker` for the
  scalable path:
  1. download (split with ffmpeg into 10-minute chunks above the provider's
     limit);
  2. transcribe and store the timestamped Transcript;
  3. analyse into strict JSON `{summary, keyDecisions, actionItems}`,
     validated with zod, with one repair attempt;
  4. fuzzy-match each assignee to a participant;
  5. save the MeetingInsight.

  `aiStatus` moves `queued → transcribing → summarizing → done` with `ai:status`
  pushed to the team, and a `summary_ready` notification goes to everyone who
  attended.
- **Retries and failure:** 3 attempts with exponential backoff (10s, 20s…).
  Non-retryable errors (deleted meeting, missing file, rejected key) skip the
  remaining attempts. The final failure stores a UI-safe message, and the host
  gets a **Retry** button.
- **Providers:** `GroqProvider` (Whisper + Llama 3.3 70B, JSON mode),
  `GeminiProvider` (both steps, key in a header), a `FallbackProvider`
  (Groq → Gemini when both keys exist), and `MockProvider`.
- **Meeting page** (`/app/meetings/:id`): live step-by-step progress, error
  plus Retry, summary, key decisions, action items with owner and due date
  (unmatched names flagged), and a timestamped transcript. Dashboard rows
  link to it and show an AI badge that updates live, and notifications now
  link to their meeting or room.
- **Three seeded past meetings** in the demo team (sprint planning, launch
  retro, design review), each with a transcript, summary, decisions and owned
  action items. They are marked `seeded: true`, and the demo cleanup never
  deletes them, even at `-- 0`.
- **Evaluation script** (`npm run eval:ai`): runs the configured provider over
  the sample transcripts in `server/fixtures/` and prints every produced item
  next to the reference, with owner/deadline ticks and recall/precision.
- **The e2e suite cleans up after itself**: specs prefix their meetings with
  `E2E `, and a global teardown deletes them through the API.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Server decides the upload target** | Only the server knows whether Cloudinary is configured. A discriminated union (`cloudinary` / `server`) keeps the client to one code path, and the no-account path makes the feature testable today. |
| **Raw body for the local upload, not multipart** | The browser holds one Blob. `express.raw` with a route-level limit avoids a multipart dependency for one endpoint, and the global 1 MB JSON cap does not apply to it. |
| **A queue interface in front of BullMQ** | BullMQ runs Lua scripts on a real Redis, which the unit suite deliberately does not have. Tests use a `MemoryQueue` and call `processMeeting` directly; the running server and the e2e test use BullMQ. |
| **Atomic status change, not job-id dedupe** | `findOneAndUpdate({aiStatus: {$nin: [in progress]}})` means a double-clicked upload cannot enqueue twice. A fixed BullMQ job id would also silently swallow a legitimate retry after a failure. |
| **`analyze()` shared by every LLM provider** | Prompting, JSON extraction, zod validation and the single repair turn live in one tested function (`analyzeWithLlm`); providers only implement `complete()`. |
| **Exactly one repair attempt** | The repair replays the conversation with the model's bad reply and the exact zod issues, which fixes the usual failures ("Friday" instead of a date, a missing field). A model that fails twice will not succeed on the same prompt a third time, and the queue's own retry is the better place for another attempt. |
| **The prompt states the meeting date and weekday** | Otherwise "by Friday" cannot become a date. The schema *requires* `YYYY-MM-DD`, so a vague value triggers a repair rather than reaching a task board. |
| **Conservative assignee matching** | Every spoken token must match the account name (initials and small typos allowed), and a tie returns *nobody*. A wrong owner silently puts a task on somebody else's board; no owner lets the host choose. Unmatched names are kept and flagged, not dropped. |
| **Retryable vs permanent errors** | 429/5xx/network retry with backoff; 401/403, missing files and deleted meetings fail immediately instead of burning three attempts and a minute of backoff. |
| **UI error messages built from status codes only** | `describeFailure` never includes a provider's response text, so a key echoed back by a vendor can never reach the page. |
| **Mock provider reads the transcript** | Canned output would make the eval meaningless. Simple rules ("we agreed" is a decision, "I'll…" is owned by the speaker) give a real baseline, 73%, that a model has to beat. |
| **`ai:status` goes to the team room** | By the time a summary is ready everyone has usually left the call, and any team member can open the page. |
| **Narrow cache invalidation on `ai:status`** | Invalidating all `['meetings']` would refetch the room's by-code query, which returns 409 for an ended meeting and would replace the "meeting has ended" screen with an error. Found while wiring it, and unit-tested. |
| **Seeded dates shift by whole weeks** | Transcripts say "by Friday". Reference deadlines only stay true if Friday is still a Friday after the history is moved to look recent. |
| **`@ffmpeg-installer/ffmpeg` instead of `ffmpeg-static`** | `ffmpeg-static` downloads its binary in an install script, and this project's npm install-script policy blocks that (verified: the binary was missing). The installer ships binaries as per-platform optional packages with no script, so it works the same locally, in CI and in Docker. `FFMPEG_PATH` can point at a system binary instead. |
| **Recording is audio only** | The transcript is what the AI needs. At 32 kbps an hour is ~14 MB, under Groq's 25 MB limit without splitting. Composite video was optional in the plan. |

### Bugs found while building

1. **A text index made transcripts impossible to insert.** MongoDB text indexes
   treat a field called `language` as a per-document stemming language, so
   `language: null` failed to insert, and so would any language Mongo's text
   search doesn't support (`"tamil"`, which Whisper returns for a Tamil
   meeting). Found by a demo cleanup test. Fixed with `language_override:
   'textSearchLanguage'`. The already-built index in the local database was
   dropped so the corrected one gets built on the next start.
2. **The mock never found "Decision: ..." lines**: `decision:` sat inside a
   `\b…\b` group, and there is no word boundary between a colon and a space.
   Found by a unit test.
3. **Refetching after `ai:status` would break the ended-meeting screen** (see
   decisions). Caught before it shipped.
4. **Deleting a meeting left its chat and notifications behind**, so a
   "summary ready" could link to "Meeting not found". Deletion now cascades to
   messages, transcripts, insights, notifications and local recording files.
5. **The e2e suite had left 72 meetings** in the shared demo workspace, pushing
   the seeded history off the dashboard. The suite now deletes what it
   creates.

### AI evaluation (mock baseline)

`npm run eval:ai -w @intellmeet/server` over the three fixtures, with
`AI_PROVIDER=mock`:

| | Result |
| --- | --- |
| Key decisions | recall 57%, precision 100% |
| Action items | recall 82%, precision 82% |
| Of found items | owner 100%, deadline 89% |
| **Action items fully correct** (found + owner + deadline) | **8/11 = 73%** |

These rules are the floor, not the target. The misses are exactly where
keyword rules fall down: a request phrased over two turns, "the twenty-fifth",
a decision stated as "Decision: …" versus "Right. Decision: …". Run the same
command with a Groq key to measure the real model against the >85% target;
the script prints every pairing so the numbers can be checked by reading.

### Known limitations

- **Whisper does not identify speakers.** Real transcripts have
  `speaker: null`, so the model attributes "I'll do it" from context and
  names, not from who said it. The seeded meetings and fixtures do have
  speakers. The fix is per-participant recording or a diarisation model,
  which would pair naturally with an SFU (server-side egress per track).
- **Only the host records**, and the host's tab must stay open until the
  upload finishes. Leaving mid-recording still stops and uploads, but closing
  the tab outright loses the recording.
- **Local recording storage is not durable on Render** (the disk is wiped per
  deploy). Production must set the Cloudinary variables. Deleting a meeting
  does not delete its Cloudinary asset.
- **The recording can't be played back in the UI yet.** `GET
  /api/meetings/:id/recording/audio` exists (with Range support), but it needs
  the bearer token, so the Phase 7 player will fetch it as a blob. *(Phase 7:
  done, and it turned out the endpoint answered 500 for every local
  recording; see the Phase 7 log.)*
- **Very long transcripts** (over 48k characters, ≈ 90 minutes) have their
  middle elided before analysis; the opening and closing are kept.
- **The mock cannot hear.** With `AI_PROVIDER=mock` every recording produces
  the same scripted stand-up, using the real participants' names.
- **`jobs/meetingQueue.ts` is 33% covered by unit tests.** Its BullMQ half
  needs a real Redis; the e2e recording test exercises it end to end instead.
- **The eval measures analysis, not speech recognition.** The fixtures are
  transcripts; measuring word error rate needs real audio.
- **Playwright uses the installed Chrome** (`channel: 'chrome'`); CI in
  Phase 11 needs the bundled Chromium.
- One unexplained client test failure was seen in about 15 full runs (the
  meeting page test, 10s, while the dev server was rebuilding). It could not
  be reproduced in 9 further runs; its first wait was given a 5s allowance
  like the routing test's.

### Manual test script

Prerequisites: `docker compose up -d`, `npm run seed -w @intellmeet/server`,
`npm run dev`.

1. <http://localhost:5173> → **Try Live Demo**. The dashboard's recent
   meetings include three with a **Summary ready** badge (scroll, or run the
   demo cleanup if other meetings crowd them out). Open **Sprint 14
   planning**: summary, two decisions, four action items with owners and
   dates, and the transcript.
2. **New meeting** → *IntellMeet Demo Team* → **Start now** → **Join
   meeting**.
3. Incognito window: sign in as `ada@intellmeet.app` / `DemoPassword123`,
   open the invite link, **Join meeting**. The remote tiles show
   **Connecting…** briefly, then video.
4. Window 1 (host): **Record**. Both windows show a red **Recording** badge.
   Ada has no Record button.
5. Talk for a few seconds, then **Stop recording**. Expect the toast
   "Recording saved".
6. Window 1: **End for all** → **Summary and action items**. The page walks
   through *Recording received → Transcribing → Writing the summary* and fills
   in by itself. The bell shows **Meeting summary ready**, which links back
   here.
7. To see a failure: stop the API mid-processing, or set `AI_PROVIDER=groq`
   with a wrong key. After the retries the page shows the reason and a
   **Retry** button (host only).

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **398 passed** (287 server, 111 client) |
| `npm run test:e2e` | ✅ **3 passed**: mesh with frames verified, controls, and record → AI summary |
| Server coverage | ✅ **91.6% statements**, 81.6% branches |
| Horizontal overflow at 360px | ✅ none, dashboard and meeting page |
| `npm run build` | ✅ all 3 workspaces |

### Next phase

**Phase 7 — Post-Meeting Dashboard & History:** a meetings list with
upcoming/live/past filters and text search across titles, summaries and
transcripts (the text indexes exist now), the meeting page grown into tabs
(summary, action items, searchable transcript with click-to-seek audio, chat
log, recording), host editing of AI output, and Markdown/PDF export.

---

## Phase 5 — Meeting Room (Real-Time Video Core) ✅

**Completed:** 2026-09-24

### Phase 4 follow-up 1: invite links lost the code after signing in

**Symptom:** opening `/join/CODE` while signed out, then pressing "Sign in" or
"Create an account", landed on `/app` without joining — although the page
promised "you will join it automatically". Opening the same link while already
signed in worked.

**Cause, found by reproducing it in a test rather than by reading the code.**
The router state survived perfectly: `postAuthPath` was handed
`{ from: { pathname: '/join/ABC234' } }` and returned the right destination.
The problem was that *two* places redirect after a sign-in, and they disagreed:

- `useOnSignedIn` navigates to the remembered page;
- `PublicOnlyRoute` redirects because a signed-in user should not sit on
  `/login` — and it redirected to a **hardcoded `/app`**.

Both updates land in the same React commit, so whichever ran second won. The
guard usually won, and silently overwrote the destination.

**Fix, in two parts:**

1. **One shared decision.** `postAuthPath(state, pendingInvite)` is now the
   single answer to "where does a freshly signed-in user go", and both callers
   use it. The race still happens; it is simply no longer observable, because
   both answers are identical. The same function also closed an open redirect
   that was there from Phase 4: `from.startsWith('/')` accepts
   `//evil.example`, which is a protocol-relative URL to another origin.
2. **The code is parked in `sessionStorage`.** Router state only carries the
   invite for somebody who uses the buttons on the invite screen. Reaching the
   sign-up form any other way — a second tab, an email link, a password manager
   — loses it. The join page now remembers the code when it shows the
   signed-out screen and clears it once redemption has been *attempted*, so a
   dead code cannot follow the user into every later sign-in.

Five tests cover it: both buttons, the already-signed-in path, the fresh-tab
path, and that an unredeemable code is discarded.

### Phase 4 follow-up 2: demo workspace hygiene

**The problem:** every reviewer signs into the same account, so every team and
meeting any of them creates is visible to all the others. It accumulates.

**Options considered.**

| Option | Why not |
| --- | --- |
| **A reset endpoint** | Everyone holding the demo session is the same user, so there is no way to authorise it. One reviewer pressing "reset" would delete the team another is mid-call in. |
| **A manual reset script only** | Requires somebody watching. Reviewers arrive at unpredictable times, including overnight. |

**Chosen: age-based automatic cleanup, plus a manual script for impatience.**

A sweep runs in-process every `DEMO_CLEANUP_INTERVAL_MIN` (30) and deletes
anything the demo account created more than `DEMO_DATA_TTL_HOURS` (6) ago:
throwaway teams, their meetings, orphaned chat and stale notifications. Two
things are never touched — the seeded team, matched by slug, and **anything
recent**. That second rule is the whole point: it is what makes the job safe to
run while people are using the product, which a reset button can never be.

`npm run demo:cleanup -w @intellmeet/server -- 0` does the same thing
immediately, ignoring the age, for clearing the decks right before a demo.

In-process rather than a platform cron because Render's free tier has no
scheduler and this is a handful of indexed deletes — not work that deserves its
own service. Concurrent runs are harmless: the deletes are idempotent.

*Verified live:* the workspace had accumulated a stray `demo` team and five
abandoned meetings from earlier testing. The script removed exactly those and
left the seeded team, its four members and every real account intact.

### Built

- **Lobby:** camera preview, camera and microphone pickers, a live mic level
  meter, mute/camera toggles before joining, and the display name.
- **WebRTC mesh** in `MeshTransport`, behind a `MediaTransport` interface: one
  `RTCPeerConnection` per peer, perfect negotiation, ICE relayed through the
  existing socket, ICE restart on failure, cleanup on leave and on tab close.
- **Video grid:** responsive from one tile to eight-plus, active-speaker ring
  driven by Web Audio, name labels, and mute/camera/screen/reconnecting
  indicators.
- **Controls:** microphone, camera, screen share with auto-revert, leave, and
  the host's mute-all, mute-one and end-for-everyone.
- **Side panel:** chat with history, typing indicator and an unread badge, and
  a participants list with per-person host controls.
- **Meeting creation dialog with a team picker**, replacing "start in your
  first team", with schedule-for-later as a checkbox.
- Copy invite link, meeting timer, STUN-only warning, mesh soft-cap warning.
- **HTTPS dev mode** (`npm run dev:https`) so the room can be tested from a
  phone on the same WiFi.
- **Playwright smoke test:** two browser contexts with fake media join one
  room, see each other's tiles and exchange chat.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Perfect negotiation rather than a "who offers first" rule** | Glare is not an edge case: starting a screen share renegotiates, and two people doing that within a second of each other is ordinary. Any fixed rule breaks when two people join in the same instant. Politeness is decided by comparing socket ids, which is deterministic and guaranteed opposite at the two ends. |
| **`replaceTrack` for screen sharing, not remove-and-add** | The SDP is unchanged, so there is no renegotiation, no glare and no black frame while an answer comes back. Starting a share is instant for everyone rather than a visible stutter. |
| **Toggling mutes a track; it does not stop it** | A stopped track has to be re-acquired and renegotiated with every peer — a stall, and the camera light flickering. `track.enabled = false` stops the media instantly and leaves the sender in place. |
| **The mesh is behind a `MediaTransport` interface** | The grid, the controls and the panel know only "peers with streams". Swapping in LiveKit later replaces one class and leaves the UI untouched. Documented in `docs/architecture.md`. |
| **ICE restart rather than rebuilding the connection** | A failed ICE connection is usually a network change — WiFi to mobile, a VPN coming up. Re-gathering on the existing connection recovers the call without the peer's tile disappearing. |
| **Host mute is a request the client honours** | The server never touches media, so the participant's own browser stops the track. That keeps the honest "you were muted" signal instead of a server silently dropping audio. |
| **One shared `AudioContext` for every level meter** | Browsers cap how many a document may create (Chrome allows six). A context per tile would hit the ceiling in a six-person call and then fail silently. |
| **The mic meter writes to `style.transform`, not React state** | At 60fps a `setState` per frame would re-render the whole lobby sixty times a second to move one bar. |
| **Active speaker polled at 300ms, not per frame** | It decides which tile gets a ring. Re-rendering the grid at 60fps for that is pure waste. |
| **A styled native `<select>` for device pickers** | Opens the platform's own wheel or sheet on a phone — more usable, more accessible and several kilobytes lighter than a custom listbox reimplementing keyboard and touch behaviour. |
| **Joining without a camera is allowed** | Somebody on a locked-down laptop, or who declined the camera prompt but not the microphone, can still watch and use chat. The hook falls back full → audio-only → none and says which happened. |
| **The room is its own lazy chunk** | Nobody downloads a WebRTC mesh to read the dashboard. |
| **The lobby owns the stream, the room borrows it** | Acquiring it once in `RoomPage` means pressing Join does not re-prompt for permission. |
| **Screen share button hidden where unsupported** | iOS has no `getDisplayMedia` at all. Offering a button that can only fail is worse than not offering it. |

### Testing from a phone: HTTPS dev mode

Browsers only expose `getUserMedia` in a **secure context** — HTTPS, or
localhost as a special case. A phone reaching `http://192.168.1.x:5173` has no
camera API at all, which surfaces as a baffling "cannot read properties of
undefined" rather than a permission prompt.

**Options considered.**

| Option | Verdict |
| --- | --- |
| **ngrok** | Needs an account, which the project rules say to ask about first. |
| **cloudflared quick tunnel** | No account, but a third-party binary, and it routes all traffic through Cloudflare. It also puts the phone on the far side of carrier-style NAT, so the call would need TURN — which is not configured. |
| **A self-signed certificate on the dev server** | Chosen. |

**Chosen: `npm run dev:https`.** `@vitejs/plugin-basic-ssl` serves the existing
dev server over HTTPS with a self-signed certificate and binds to every
interface. No account, no third party, and — the deciding factor — the phone
stays on the same LAN as the laptop, so the two peers find each other with STUN
alone. A tunnel would have made TURN a prerequisite for the one scenario most
worth testing.

The catch is the certificate warning, which has to be accepted once on the
phone. Vite also proxies `/socket.io` now, because an HTTPS page may not open a
plain `ws://` connection: without a same-origin socket the app would load and
then silently fail to connect.

### Manual test script

Both scripts assume `docker compose up -d` and `npm run seed -w
@intellmeet/server` have been run.

#### A. Two windows on one PC

1. `npm run dev`.
2. Window 1 (normal): <http://localhost:5173> → **Try Live Demo**.
3. Window 2 (**incognito**, so it is a separate session): <http://localhost:5173>
   → **Sign in** → `ada@intellmeet.app` / `DemoPassword123`.
4. Window 1: **New meeting** → team *IntellMeet Demo Team* → title → **Start
   now**. Allow camera and microphone. You land in the lobby.
5. Window 1: check the preview, switch camera/microphone in the pickers, speak
   and watch the level meter move. Press **Join meeting**.
6. Window 1: **Invite** → the link is copied. Paste it into window 2.
7. Window 2: allow permissions → **Join meeting**.

   **Expect:** both windows show *2 in the room* and two tiles; each sees the
   other's video within a couple of seconds.

8. Speak in one window → the speaker's tile gets a green ring in both.
9. Window 1: mute → window 2 shows a mic-off icon on that tile.
10. Window 1: **Share screen** → pick a window → window 2's tile for you shows
    the screen and a screen icon. Press the browser's own **Stop sharing** bar
    → both revert to camera automatically.
11. Chat: send from each side; check the typing indicator appears while the
    other is typing, and that the **People** tab shows an unread badge on
    **Chat** when a message arrives while you are on it.
12. Window 1 (host): **Mute all** → window 2 is muted and told so.
13. Window 2: **Leave** → window 1 shows *1 in the room*.
14. Window 1: **End for all** → both see "The meeting has ended".
15. Reload window 1 and open the meeting again → it refuses with "That meeting
    is not available", because an ended meeting cannot be rejoined.

#### B. PC plus phone, same WiFi

1. Find the laptop's LAN address: `ipconfig` on Windows, `ifconfig | grep inet`
   on macOS/Linux. It looks like `192.168.1.23`.
2. Add it to `server/.env` so the API accepts it, then restart the API:

   ```bash
   CORS_ORIGINS=http://localhost:5173,https://192.168.1.23:5173
   CLIENT_URL=https://192.168.1.23:5173
   ```

   (Only needed for the invite links to point at the right host; the socket and
   REST both go through the Vite proxy, so they are same-origin.)

3. `npm run dev:https` on the laptop.
4. Laptop: <https://localhost:5173> → accept the certificate warning
   (**Advanced → Proceed**) → **Try Live Demo** → start a meeting → join.
5. Phone, on the **same WiFi**: open `https://192.168.1.23:5173`.
   - Chrome: *Advanced → Proceed to 192.168.1.23 (unsafe)*.
   - Safari: *Show details → visit this website → Visit Website*.
6. Phone: **Sign in** as `ada@intellmeet.app` / `DemoPassword123`, then open the
   room code from the laptop's **Invite** button.
7. Allow camera and microphone when prompted, then **Join meeting**.

   **Expect:** laptop and phone see each other. Both are on the same LAN, so
   STUN is enough and no TURN is needed.

8. Rotate the phone → the grid reflows and the controls stay reachable.
9. Turn the phone's WiFi off and on → the tile reconnects by itself (ICE
   restart) rather than vanishing.
10. Note: **screen sharing is hidden on the phone**, because iOS and Android
    browsers have no `getDisplayMedia`.

**If the phone shows no camera prompt at all**, the page is not on HTTPS —
check the URL starts `https://` and that the certificate was accepted.

### STUN only: what works, and when TURN is needed

`GET /api/rtc/ice-servers` currently returns Google's public STUN and
`hasTurn: false`, and the room shows a banner saying so.

**Works on STUN alone:** two laptops on one home or office WiFi; a laptop and a
phone on the same network; most home broadband to home broadband connections.
Roughly 80–90% of real connections.

**Needs TURN:** a corporate or university network that blocks UDP; mobile data
behind carrier-grade NAT (usually symmetric); guest WiFi with client isolation.

So: **local testing and a demo over home WiFi are fine. A demo over a
conference or corporate network, or with someone joining on 4G, is not.** Add
TURN before presenting anywhere you do not control the network. Metered's free
tier is 500 MB of relayed traffic a month, which is ample because only the
connections that need it use the relay:

```bash
TURN_URLS=turn:standard.relay.metered.ca:80,turns:standard.relay.metered.ca:443
TURN_USERNAME=<from the dashboard>
TURN_CREDENTIAL=<from the dashboard>
```

Restart the API; `hasTurn` flips to `true` and the banner disappears. Nothing
else changes — the endpoint has been ready since Phase 3.

### Bugs found while building

1. **The e2e suite's sign-in assertion was ambiguous.** It waited for an h1
   matching "Welcome back" — which is the *sign-in page's own heading* as well
   as the dashboard's. It passed instantly while the login request was still in
   flight, and the next navigation cancelled it. Now it waits on the URL.
2. **The demo account was in two teams**, so the creation dialog defaulted to
   the wrong one and the other participant got "Team not found". Found by the
   e2e suite; it is also precisely the debris that the new cleanup removes. The
   spec now selects the team by name rather than trusting the default.

### Known limitations

- **Mesh only, soft-capped at six.** Above that the UI warns and quality
  degrades. The LiveKit upgrade path is documented in `docs/architecture.md`.
- **No TURN**, so restrictive networks will fail. See above for exactly when.
- **No recording yet** — Phase 6.
- **Screen sharing is desktop-only**, because mobile browsers have no
  `getDisplayMedia`.
- **No speaker (output device) selection.** `setSinkId` is not supported in
  Safari or on Android, so a picker would be a control that silently does
  nothing for a large share of users.
- **Active-speaker detection is local.** Each browser measures the streams it
  receives, so the highlight can differ by a frame between participants. A
  server-side dominant-speaker signal needs an SFU.
- **Chat history loads the most recent page only.** The cursor exists; infinite
  scroll in the panel does not.
- **The Playwright suite needs Chrome installed** (`channel: 'chrome'`),
  because this machine could not download Playwright's bundled Chromium.
  `npx playwright install chromium` and dropping the `channel` line switches to
  the pinned build.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **250 passed** (183 server, 67 client** |
| `npm run test:e2e` | ✅ **2 passed** — two browsers, real media, real mesh |
| Server coverage | ✅ **91.7% statements**, 83.5% branches** |
| Horizontal overflow at 360px | ✅ none, lobby and room |
| `npm run build` | ✅ all 3 workspaces |

### Next phase

**Phase 6 — Recording & AI Meeting Intelligence:** mixing every audio track
with the Web Audio API, recording with `MediaRecorder`, uploading to Cloudinary,
and the BullMQ `process-meeting` job that transcribes with Groq Whisper,
summarises with Llama, validates the JSON against a zod schema and retries once
with a repair prompt, then fuzzy-matches assignees to participants.

---

## Phase 4 — Frontend Foundation ✅

**Completed:** 2026-09-24

### Phase 3 follow-up: `meeting_started` fired from REST

Phase 3 left the helper written but never called. It now runs on both paths
that take a meeting live:

- **`POST /api/meetings`** without a `scheduledAt` — the "start now" flow, which
  creates the meeting already `live`.
- **`POST /api/meetings/:id/start`** — but only on the actual transition.

`startMeeting` is idempotent, so the DTO alone cannot tell "this call started
it" from "it was already live". It now returns `{ meeting, started }`, and the
controller notifies only when `started` is true — otherwise a double-clicked
Start button, or a client that retried, would notify the whole team twice.

`notifyMeetingStarted` moved out of `sockets/socket.handlers.ts` (where it was
dead code) into `modules/meetings/meeting.notify.ts`, next to its only caller.
The dependency runs one way — the meetings module reaches for `getIo()`, and
nothing in `sockets/` imports this file — so there is no cycle. Persistence and
delivery stay separate: the rows are written first, so someone who was offline
still finds the notification in the bell, and the socket push is best-effort on
top. Nothing in it can throw, because the meeting really did start.

### Built

- **Router** with three zones: public (`/`, `/join/:code`), public-only
  (`/login`, `/register`) and protected (`/app/*`), each with its own guard.
- **API client** — bearer token from memory, one refresh-and-retry on a 401,
  concurrent refreshes funnelled into a single request, every response parsed
  with the shared zod schema, every failure surfaced as a typed `ApiError`.
- **Socket singleton** that connects when a session exists, re-reads the token
  on every reconnection, and is torn down on sign-out.
- **App shell** — persistent rail from `md` up, slide-in sheet below, with a
  notifications bell (live over the socket) and a light/dark/system theme
  toggle.
- **Auth pages** on the shared zod schemas, with inline field errors, loading
  states and a demo shortcut.
- **Landing page** — hero, four usage steps, feature grid and two "Try Live
  Demo" buttons.
- **Team pages** — create, join by code, members list, invite link with a copy
  button, role changes and member removal.
- **Settings** — display name, theme, and the Phase 1 health card as a system
  status panel.
- Toasts, an error boundary, skeleton loaders, a 404 page, and honest
  "arriving in Phase N" placeholders for the routes later phases fill in.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Access token in a plain variable, never in localStorage** | localStorage is readable by any script on the origin, so one XSS hands an attacker a token they can use from their own machine. Memory dies with the tab; the httpOnly refresh cookie - which script cannot read at all - is what survives a reload. |
| **Single-flight refresh** | A dashboard mounting four queries gets four simultaneous 401s the moment the token expires. Four parallel refreshes with the same cookie means the first rotates it and the other three look exactly like a replayed token. One promise, three awaits. |
| **Exactly one retry after a refresh** | If the second attempt is also unauthorised, the account lost access rather than the token expiring. Looping would only delay telling the user. |
| **Auth endpoints opt out of refresh-and-retry** | A 401 from `/login` means the password was wrong. Refreshing in response would hide the real failure behind a second, more confusing one. |
| **`refreshSession` resolves, never rejects** | The startup bootstrap calls it without a catch. A rejected promise on a dropped connection would strand the store on `bootstrapping` and spin every protected route forever, for what is usually a two-second network blip. |
| **A three-way auth status, not a boolean** | `bootstrapping` is the state before the first refresh settles. Without it, a hard reload bounces a signed-in user to /login for a few hundred milliseconds and loses the page they were on. |
| **The socket lives in a store, not a module variable** | React runs effects bottom-up, so the notification bell's effect runs *before* the shell above it connects. Reading a module variable at that moment gives null and the listener is never attached - a bug that only shows up as "notifications work after a refresh". A store is a value components can depend on. |
| **`auth` passed to socket.io as a function** | It is re-evaluated on every reconnection, so a socket that drops while the token is expiring comes back with the current one. An object literal here is the classic cause of "reconnects, then immediately fails auth". |
| **Route guards are convenience, not security** | Every protected route's data comes from an endpoint that checks the bearer token itself. A user who edits past the guard sees an empty shell and a stack of 401s. |
| **The signed-in half of the app is a lazy chunk** | The landing page is the first thing every reviewer downloads and needs none of the dashboard. Keeping `useSocketLifecycle` in the shell rather than the root also keeps socket.io-client out of the public bundle entirely. |
| **Theme as a store, with a blocking inline script in `index.html`** | A deferred script runs after first paint, which is the flash of the wrong theme every dark-mode implementation has to solve somewhere. A store also avoids the provider-plus-hook pattern that breaks Fast Refresh. |
| **"System" is a real third theme option** | A two-state toggle silently overrides the OS schedule the first time it is pressed. |
| **Query cache cleared on sign-in and sign-out** | Nothing cached belongs to the account that just arrived. |
| **Logout uses `onSettled`, not `onSuccess`** | If the network call fails the user still asked to sign out. A half-signed-in state is worse than a refresh token that outlives the tab by a few minutes. |
| **Mutations never retry** | A retried mutation is a duplicate write. The user can press the button again. |
| **`refetchOnWindowFocus` off** | Most of this data also arrives over the socket, so focus refetching would duplicate work the realtime layer already does. |
| **Placeholder routes wired now** | The navigation, the guards and the layout are exercised end to end from this phase, instead of being bolted together in Phase 5. Naming the phase keeps a placeholder from reading like a bug. |
| **The Phase 1 health card moved to Settings rather than being deleted** | "Is the backend up?" is genuinely useful to an operator - or a reviewer running this locally - without opening a terminal. |

### Accessibility

Lighthouse on the production build of the landing page: **accessibility 100**,
zero failed audits. The target was ≥ 90.

What that score is actually made of: one `h1` per page, a skip link as the
first tabbable element, `aria-label` on every icon-only button, `aria-invalid`
plus `aria-describedby` wiring each field to its error, `role="alert"` on
submission failures, `aria-live` regions around loading states, visible focus
rings on every interactive element, and `aria-hidden` on decorative icons and
the hero mock. The mobile nav is a Radix dialog rather than a hand-rolled
drawer, so focus trapping, focus restoration and Escape-to-close come for free.

### Bugs found while building

1. **The notification bell would have attached its socket listener to nothing.**
   React runs effects bottom-up, so the bell's effect ran before the shell
   above it had connected, and `getSocket()` returned null. Found while moving
   the socket out of the public bundle; fixed by making the socket a store
   value the effect can depend on. It would have looked like "live
   notifications only work after a page refresh".
2. **A network failure during startup left the app spinning forever.**
   `useSessionBootstrap` calls `refreshSession()` without a catch, so a
   rejected fetch left the store on `bootstrapping` and every protected route
   on a spinner. `performRefresh` now catches and resolves to null.
3. **A single 691 kB bundle on the landing page.** Route-level `lazy` plus
   moving the socket lifecycle into the shell cut the public bundle to 605 kB
   (191 kB gzipped) and gave the signed-in app its own chunks.

### Known limitations

- **The public bundle is still 191 kB gzipped.** It is React, the router,
  React Query, Radix and zod - no single culprit, and zod is the deliberate
  price of one schema shared by client and server. Lighthouse performance is
  82 on simulated mobile, with 520 ms of total blocking time. Revisit in
  Phase 10.
- **No avatar upload yet.** The signed-upload endpoint exists (Phase 2) but
  needs Cloudinary credentials, so Settings only edits the display name.
- **Email changes are not supported**, because changing one means re-verifying
  it - a flow of its own rather than a field on a form.
- **The meetings, room, tasks and analytics routes are placeholders.** They are
  wired and guarded, but their features land in Phases 5, 7, 8 and 9.
- **No Playwright suite yet.** Component and integration tests cover the forms,
  the client and the routing; browser-level end-to-end arrives with the meeting
  room in Phase 5.
- **Presence is not surfaced in the UI.** The backend broadcasts it; the
  participant list that consumes it is part of the meeting room.
- The dashboard starts a meeting in the user's *first* team. A team picker
  arrives with the meeting creation dialog in Phase 5.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **205 passed** (173 server, 32 client) |
| Lighthouse accessibility (landing, prod build) | ✅ **100** (target ≥ 90) |
| Lighthouse performance / best practices / SEO | 82 / 96 / 91 |
| Horizontal overflow at 360px | ✅ none, landing and dashboard |
| `npm run build` | ✅ all 3 workspaces |

### Manual verification performed

Against the real Docker MongoDB and Redis, with a socket client standing in for
a second browser:

```
POST /auth/demo                    200, Demo User <demo@intellmeet.app>
POST /auth/login (teammate)        200, Ada Lovelace
GET  /teams                        1 team, "IntellMeet Demo Team", 4 members
socket handshake (teammate)        connected, transport websocket
POST /meetings (start now)         201, status live, code 5VF7SVS
notify:new received live           "Meeting started" - "..." has started
payload links to the room          { meetingId, teamId, roomCode, hostName }
GET  /notifications (persisted)    1 meeting_started, unreadCount 1
scheduled create sends nothing     unchanged
POST /:id/start notifies           "... has started"
repeat start does not re-notify    2 total after 3 more start calls
```

Headless Chrome over CDP, at a 360 px viewport:

```
landing    clientWidth 360 | scrollWidth 360 | overflowX 0 | 0 offenders
dashboard  clientWidth 360 | scrollWidth 360 | overflowX 0 | 0 offenders
```

### Next phase

**Phase 5 — Meeting Room:** the lobby with camera/mic preview and device
selectors, a WebRTC mesh behind a `MediaTransport` interface using perfect
negotiation, the responsive video grid with active-speaker highlighting,
controls for mic/camera/screen share and the host's mute-all and end-meeting,
and the side panel with chat and the participants list. The signalling backend
and the ICE endpoint are already live from Phase 3.

---

## Phase 3 — Meetings API, Socket.io, Chat, Presence, Notifications ✅

**Completed:** 2026-09-23

### Phase 2 follow-up fix: demo session isolation

**Problem:** reuse detection revoked *every* refresh token for the account. On
the shared demo account that meant one reviewer's two-tab refresh race signed
out every other reviewer at once.

**Approach chosen: token families as the primary mechanism, plus a short reuse
grace window inside a family.** Both options were on the table; here is why the
answer is both rather than either.

- **Families fix the blast radius.** Every sign-in starts a `familyId`, and
  every rotation inherits it. Reuse detection now revokes that family alone.
  This follows the OAuth 2.0 Security BCP, which revokes the tokens issued for
  the affected *grant*, not the whole user. Grace alone would not have fixed
  this: a genuinely stolen token would still have nuked everyone.
- **The grace window fixes the false positive.** Families alone still sign the
  *racing* reviewer out, and the race is not hypothetical - each browser tab is
  its own JavaScript context, so the Phase 4 client's single-flight refresh
  queue cannot merge across tabs. Two tabs *will* present the same cookie.
  Within `REFRESH_REUSE_GRACE_MS` (10s), and only while the family still has a
  live token, a replay is treated as a concurrent refresh and issued a sibling
  token instead of being rejected.
- **Cost, stated plainly:** a genuinely stolen token is accepted for up to the
  grace window after it was rotated. `REFRESH_REUSE_GRACE_MS=0` disables it.
- **Why a sibling rather than replaying the original successor:** only the
  successor's *hash* is stored, so its raw value cannot be handed out twice.

**Session cap:** `MAX_SESSIONS_PER_USER` (default 20), applied on every token
write via `$push` with `$each`/`$sort`/`$slice: -N`. Expired tokens are pulled
first so the cap is spent on live sessions. `revokeAllSessions` was removed -
nothing calls it any more, and family-scoped revocation is the correct default.

### Built

- **Meetings**: full CRUD scoped to team membership, schedule vs start-now,
  unique 7-character room codes, join-by-code, start/end lifecycle, text
  search, pagination.
- **Socket.io**: JWT handshake auth, Redis adapter, room join/leave with
  participant tracking, WebRTC signalling relay, media-state broadcast, host
  mute and end-for-everyone, per-socket chat throttling.
- **Chat**: persisted messages, socket broadcast, typing indicators, and
  cursor-paginated history at `GET /api/meetings/:id/messages`.
- **Presence**: Redis-backed, per team, announced once per user rather than
  once per tab.
- **Notifications**: model, list with unread count, mark-read, mark-all-read,
  real-time push via `notify:new`.
- **`GET /api/rtc/ice-servers`**: STUN always, TURN when configured; the TURN
  credential stays server-side.
- **Meeting cache**: Redis read-through with a 60s TTL, invalidated on write.

### Decisions & trade-offs

| Decision | Why |
| --- | --- |
| **Socket auth via `handshake.auth.token`, not a cookie** | The socket connects straight to Render while REST goes through the Vercel rewrite, so a Vercel-scoped cookie is never sent and a Render-scoped one would be a third-party cookie browsers increasingly block. A browser also cannot set an `Authorization` header on a WebSocket. |
| **Room membership re-checked on `room:join`** | The handshake proves *who* you are, never *which* meetings you may enter. Inheriting authorisation from the handshake would let any authenticated user join any room by id. |
| **The server relays SDP/ICE without parsing it** | That is the whole point of a mesh - media is peer to peer. Parsing session descriptions would add a dependency on WebRTC internals and need updating whenever a browser changes its SDP. Payloads are typed `unknown` deliberately. |
| **Signalling only relays into rooms the socket has joined** | Otherwise a member of the team could inject offers into a meeting they never entered. |
| **The cache stores a viewer-independent view; authorisation is never cached** | `isHost` is folded in per request, and team membership is re-checked against MongoDB on every read. Caching an authorisation decision would leave a removed member with access until the TTL expired. A cache hit still costs one indexed `Team.exists` - by design. |
| **Cached DTOs, not Mongoose documents** | The DTO is all strings, so it survives a JSON round trip. A cached document's `Date` fields would come back as strings and break `.toISOString()`. |
| **Cursor pagination for chat, page numbers for meetings** | Chat is append-heavy and read newest-first, so an offset shifts under the reader every time someone sends a message. A meeting list changes slowly enough that pages are fine. |
| **Chat throttle lives on the socket, not in express-rate-limit** | Socket events never touch the Express pipeline. A socket lives on exactly one process, so per-socket state needs no sharing and disappears on disconnect. 15 messages / 10s. |
| **Sender name and avatar denormalised onto each message** | A broadcast has to render immediately; resolving `senderId` against a user cache first would stall it. The cost is that a renamed user's old messages keep the old name, which is how most chat products behave. |
| **Presence announced only on a user's first socket** | Otherwise opening a second tab makes a colleague blink offline and online again. |
| **Room state in Redis with a 12h TTL** | A process killed mid-meeting never runs its disconnect handlers, so without expiry the next visitor would see ghost participants. |
| **`notification.service` does not emit; the caller does** | It would otherwise import the socket layer, which already imports services - a genuine cycle rather than a cosmetic one. |
| **Host mute is a request, not enforcement** | The server never touches media. The participant's own client stops the track, which keeps the honest "you were muted" signal. |
| **Presence/cache failures are fail-open** | Redis going down degrades presence to "we do not know who is online" rather than stopping people joining meetings. Upstash's free tier drops connections. |
| **`AppSocket`/`AppServer` type aliases rather than a `declare module` augmentation** | Socket.io types `socket.data` through a generic parameter; augmenting the `Socket` interface collides with the generic instead of refining it. |
| **In-memory Redis stub for tests, rather than `ioredis-mock`** | Presence, room membership and the cache are genuinely Redis-backed, so stubbing each one out would mean the tests never exercise the real paths. Only the commands this codebase issues are implemented, so an unimplemented one fails loudly instead of silently returning undefined. |
| **Socket tests run a real HTTP + WebSocket server on port 0** | Handshake auth, broadcast-excludes-sender and disconnect cleanup only exist in the transport; calling handlers directly would test none of them. |

### Bugs found while building

1. **Notifications created in the same millisecond sorted non-deterministically.**
   `insertMany` gives a batch identical `createdAt` values, so the bell would
   render them in an arbitrary order that changed between reads. Both the
   notification and chat sorts now use `_id` as a tiebreaker (ObjectIds
   increase monotonically within a process).
2. **`seed.ts` and `socket.types.ts` were dragging coverage down.** A CLI
   script and a type-only module are not application code; excluding them (as
   `server.ts` already was) moved overall coverage from 87.8% to 91%.

### Known limitations

- **Mesh WebRTC only.** The signalling relay is transport-agnostic, but the
  client-side mesh (Phase 5) degrades above ~6 participants. The SFU upgrade
  path (LiveKit) gets documented in `docs/architecture.md`.
- **No TURN credentials yet**, so `hasTurn` is false and calls behind
  symmetric NATs will fail. The endpoint is ready; only env vars are missing.
- **Chat's cursor is a timestamp.** A burst of messages spanning a page
  boundary within the same millisecond could skip one. Acceptable at human
  typing speeds; a compound cursor would have to be carried by the client.
- **`meeting_started` notifications are wired but not yet triggered** by the
  REST start endpoint - the helper exists and is used by the socket layer.
- Presence is per team, not per meeting; the participant list serves that.
- The text index covers meeting titles and descriptions only. Transcript and
  insight search arrive with those collections in Phase 6.
- Socket reconnection/backoff is a client concern and lands in Phase 4/5.

### Checks

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run typecheck` | ✅ clean in all 3 workspaces |
| `npm test` | ✅ **170 passed** (167 server, 3 client) |
| Socket integration suite | ✅ 21 tests over a real WebSocket |
| Overall server coverage | ✅ **91% statements**, 83.5% branches |
| Auth module coverage | ✅ 95.4% (Phase 2 checkpoint required ≥ 70%) |
| `npm run build` | ✅ all 3 workspaces |

### Manual verification performed

Against the real Docker MongoDB and Redis, two clients over a real WebSocket:

```
two users signed in           Demo User + Ada Lovelace
meeting created               201, roomCode T6G59G3, status live
both sockets connected        transport: websocket
room join                     A sees 1 -> B sees 2, host flag true
chat relayed                  "Hello from the live check" from Demo User
rtc offer relayed verbatim    "v=0 live-check"
persisted history             1 message
disconnect cleanup            A was told B left
ice servers                   2 STUN urls, hasTurn false
```

Redis state inspected mid-session and after teardown:

```
WHILE OPEN:   presence keys 2 | room hash 1 participant | cached meeting present, TTL 58s
AFTER CLOSE:  room hash 0 participants
AFTER END:    cached meeting absent   (invalidation works)
ADAPTER:      socket.io-request#/# and socket.io-response#/# pub/sub channels live
```

### Next phase

**Phase 4 — Frontend Foundation:** React Router with public and protected
routes, an API client that keeps the access token in memory and single-flights
concurrent refreshes, a socket client singleton that reconnects with a fresh
token, the responsive app shell with a notifications bell and theme toggle,
auth pages built on the shared zod schemas, the landing page with its
"Try Live Demo" button, and team pages. Target: Lighthouse accessibility ≥ 90.

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
