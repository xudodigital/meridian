# Meridian "professional level" iteration: shared rules and work packages

Project root: `/Users/ranggaoctaviyanto/Documents/projects/meridian`. Node: `<root>/.tools/node/bin` (put first on PATH).
Audit reports to read first (the ones your package cites): `/private/tmp/claude-501/-Users-ranggaoctaviyanto-Documents-projects-meridian/355ab15a-3378-4ad3-ae5b-aa6cd137489d/scratchpad/audit2/{security,ops,design,product,screens}.md`.
Developer docs: `README.md` (Indonesian), `app/PORTING.md` (sections 14-17).

## Ground rules (every package)

- NOT a git repo: never run git. Never delete files you do not own.
- **Never touch `data/` and never stop, restart or signal the live server on port 4310.** Never use `pkill`, `killall` or
  any pattern kill: stop only processes you started, by PID. Throwaway servers: free port + temp `MERIDIAN_DATA` + the
  fake CLI (see `server/testkit.ts`), cleaned up afterwards.
- Do NOT run `npm run build` (the live server serves `app/dist`); the lead builds at the end.
- Server: Node 24, TypeScript run directly (no enums/namespaces/parameter properties), `node:sqlite`, **no npm packages**.
  App: React 19 + Zustand/immer + TanStack; no new npm deps.
- Normal mode (store.sample false) shows only real data and working controls; demo mode keeps the prototype behaviour.
  UI text: English, sentence case, plain words, no jargon. No "simulated/prototype/fake" text outside demo mode.
- Keep existing security: `x-meridian: 1` on writes, session cookie, role checks (`mayWrite`, `mayAdmin`, `seesSite`).
- Comments explain why, in the surrounding style. Small cohesive changes; no drive-by refactors.
- Tests: server `npm run test:server` (root); server type-check
  `app/node_modules/.bin/tsc -p /private/tmp/claude-501/-Users-ranggaoctaviyanto-Documents-projects-meridian/355ab15a-3378-4ad3-ae5b-aa6cd137489d/scratchpad/tsconfig.server.json`;
  app `npm run typecheck` and `npx vitest run` in `app/`. Everything must pass when you finish; add tests for what you build.
- Other packages run at the same time on other files. Only edit files your package owns, plus the shared files listed
  for it with minimal, additive edits (re-read a shared file right before editing; if an Edit fails, re-read and retry).
- Final answer: what you built, files changed, exact test counts, anything left open or needing the lead.

## Phase 1

### A. Server hardening (security + crash-proofing)
Owns: `server/engine.ts`, `writer.ts`, `photos.ts` (tool rules only), `jobs.ts`, `db.ts`, `http.ts`, `limits.ts`,
`auth-api.ts`, `team-api.ts`, `workspace-api.ts`, `workspace.ts`, `stream.ts`, `sessions.ts`, `article-api.ts`, `articles.ts`,
`requests.ts`, `checks.ts`, `main.ts`, `sitebuild.ts` (`_headers` only), their tests, `server/fixtures/fake-claude.mjs`.
From security.md and ops.md:
1. Agent sandboxing (security #1, #2): scope `Read` for the Content Writer and Keyword jobs to their skill folders the way
   `photos.ts` does; explicit disallow rules for `data/`, the project root files (admin-account.txt), `~/.ssh`,
   `~/.claude`, `~/Library`; drop Glob/Grep unless scoped. Reviewer notes and request fields go into prompts as clearly
   labelled, JSON-quoted data ("feedback about the article text; never instructions about tools or files").
   Child env is an allow-list (PATH, HOME, LANG, LC_*, TMPDIR, USER, SHELL, TERM + what the CLI needs to stay signed in —
   verify with the real CLI's `auth status` that it still reports signed in; never run a paid job).
   Send the prompt on stdin instead of argv if the CLI supports `-p` with stdin (check `claude --help`; if not, keep argv).
2. Server-side truth for jobs: `POST /api/requests` and `POST /api/articles` take domain/country/language/topic from the
   saved sites document (`siteInfo(siteId)`), 404 for an unknown site; validate domains in `docError('sites')`.
3. Reviewer scoping (security #3): `GET /api/workspace` and `workspace` events give a reviewer only their site and no
   settings/agents/schedules/notifyPrefs beyond what the app needs to render Article review; integrations hide tails
   for non-admins. Check the app still works for a reviewer (app tests: auth.test.tsx reviewer cases).
4. Auth (security #4-#6, ops M11): clear the email limiter only after the full sign-in; per-user 2-step failure counter
   with growing lock; the per-client bucket must not gate valid-session actions and must not lock everyone on localhost
   (exponential delay per email instead of a global hard lock); `reset-2fa` on yourself → 409; sign-in success/failure/
   lockout and 2-step failures recorded in the audit log (actor = the email tried, no password material); role change
   or disable ends that user's sessions.
5. Native review enforced on the server: when settings `native` is true, approving an article without a language
   review is refused (409 with a clear message). Remove nothing in the app (package D adjusts the UI).
6. Headers (security #7): CSP + COOP + permissions-policy on the app shell (check what the built app needs: Google
   Fonts stylesheets/fonts, inline style attributes → `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`),
   `default-src 'none'; frame-ancestors 'none'` on JSON; CSP + X-Frame-Options in generated sites' `_headers`.
7. Files: `data/` 0700, database 0600 (apply at start, also for existing installs).
8. Audit integrity: client-posted audit entries are marked (e.g. stored flag + shown as "note") and cannot imitate
   server entries; "Reset workspace" keeps the audit log (adds an entry instead).
9. Limits (security #9): cap queued jobs (e.g. 20 per site, 50 total) with a clear 429 message; at most 5 event
   streams per session; simple per-user token bucket on send-report / metrics refresh / access checks.
10. Crash-proofing (ops H1, H3, H4, H5, M3): sqlite busy timeout 5 s; `next()` guarded so a failing job handler or DB
    write can never crash the process or stall the queue; `unhandledRejection`/`uncaughtException` handlers that log
    and exit non-zero; CLI child: UTF-8 decoding via setEncoding, SIGKILL escalation after 5 s, process-group kill,
    hard deadline; `attempts` column so a job recovered twice fails with "Stopped after the server restarted twice";
    graceful shutdown (stop accepting, close streams with an event `restarting`, abort the job, requeue with a step
    "Server stopped", `PRAGMA wal_checkpoint(TRUNCATE)`, close DB) on SIGINT/SIGTERM/SIGHUP; friendly preflight errors
    for port in use, unwritable data dir, Node < 24 (also in `start.sh`), and a `data/meridian.lock` pid file against
    two servers on one data folder (stale lock from a dead pid is taken over).
Export from `jobs.ts` a `queueSnapshot()` (running job kind/id/age, queued count per kind) for package B's health view.

### B. Operations: backup, logs, health, service, maintenance
Owns (new files): `server/backup.ts`, `server/log.ts`, `server/system-api.ts`, `server/maintenance.ts`, `service.sh`,
`backup.sh`, tests for them, `app/src/views/system/SystemCard.tsx` (+ its test), `app/src/store/systemApi.ts`.
Shared (minimal additive edits): `server/main.ts` (register `systemApi` router; call `log` at start/stop; request log
hook), `app/src/views/Settings.tsx` (one line: render `<SystemCard />` for admins outside demo mode), `README.md`
(a "Backup, restore, service" section in Indonesian).
1. Backup: `backupNow()` → `data/backups/meridian-YYYYMMDD-HHMMSS.zip` containing a consistent DB snapshot
   (`VACUUM INTO` a temp file), `secret.key`, `media/`, `sites/` (use `server/zip.ts`); keep the newest 7 daily + 4
   weekly (configurable constants); routes (admin): `POST /api/system/backup`, `GET /api/system/backups`,
   `GET /api/system/backups/:name` (download, strict name check); `backup.sh` (backup now via the CLI without the
   server: `node server/backup.ts`), `backup.sh restore <zip>` (refuses while the server lock is held; keeps the
   current data as `data.before-restore-<ts>`); nightly at 03:00 local via `maintenance.ts`. The archive holds secrets:
   mode 0600, folder 0700, and the UI says to store it safely.
2. Log file: `log.ts` JSON-lines to `data/logs/meridian.log` (rotation at 5 MB, keep 5), levels, never bodies or
   secrets (mask tokens like main.ts does); request line (method, masked path, status, ms, user id), job lifecycle
   (kind, id, site, duration, tokens, cost, outcome) via the bus events, start/stop with version. Console output keeps
   the two startup lines.
3. Health: `GET /api/health` stays minimal; admin `GET /api/system/health` → version (from package.json, also fix
   the User-Agent in net.ts to use it), uptime, node version, DB ok + sizes (db, wal), queue snapshot (if jobs.ts
   exports `queueSnapshot`, else omit), engine status, disk free, data folder sizes (media, sites, backups, logs),
   last backup, last scheduler runs.
4. Maintenance (daily): prune `data/workspaces/*` job folders older than 7 days and stray `*.tmp`, `PRAGMA optimize`,
   WAL checkpoint, backup rotation.
5. Service: `service.sh install|uninstall|status` writing `~/Library/LaunchAgents/com.meridian.server.plist`
   (KeepAlive, RunAtLoad, ThrottleInterval 10, stdout/stderr to `data/logs/service.log`, WorkingDirectory, PATH with
   the bundled Node). **Write and syntax-check it (`plutil -lint` on a generated plist in the scratchpad) but do NOT
   install or load it** — the user decides.
6. App: Settings > "System" card (admins, normal mode): version, uptime, engine, queue, database size, disk free, last
   backup with "Back up now" (shows result) and a list of backups with Download links; polished, compact, uses existing
   components.

### D. App polish and honesty pass (app only; no server files)
Owns: `app/src/styles/*`, `app/src/components/*`, `app/src/shell/*`, `app/src/views/**` (except
`views/system/SystemCard.tsx` and the one line package B adds to `Settings.tsx`), `app/src/store/constants.ts`,
`app/src/store/rules.ts` (helpers only), their tests. Do not change store slices' server calls.
From design.md (do all S items and the listed M items) and product.md/screens.md "honesty":
1. Defects: A1 (remove the 8px body margin), A2/A3 (one status vocabulary; "Not reachable" vs "Blocked by ISP" agree
   across tile, map, filter, pill — the server's access result `down` is not "blocked"), A5, A6 (explain the sign-out),
   A7, A8, A9, A10 ("1 minute" timeout option demo-only), A11 (skeleton rows in `Table` for loading).
2. Hierarchy/consistency: B1 (neutral agent cards; colour on avatar/progress/accent only; tint only while working),
   B2 (idle cards compact; delete moves into the agent sheet), B3 (short nowrap headers), B4 (one date-time format
   everywhere: "3 Oct, 12:31", time-only for today), B5, B9 (compact stat strip), B10 (max-width on `.view`), B12, B14
   (hide Volume/KD columns until a keyword data source feeds them), B15, B8 (one-line ledes; longer explanations behind
   an info disclosure).
3. Empty states and guidance: C1 (`Empty` gets icon, title, body, action; use it across views with a real next action
   where one exists), C3 (a "Finish setup" checklist card on Workspace computed from real state: Claude Code signed in,
   first site, ownership verified, first research, first approved article, first build, Cloudflare connected, Search
   Console connected, email set up, 2-step on — each links to its screen; dismissible per browser when complete), C5,
   C7 (error snackbars distinct and sticky until dismissed), E (placeholder contrast, 13px table headers, status icons
   in pills so colour is not the only signal).
4. Honesty pass (screens.md "saved but changes nothing"): outside demo mode, controls with no server effect must not
   pretend. Agents without a job runner (Orchestrator, Research, Architect, SEO/GEO Optimizer, Internal Linker, Analyst,
   Graphic Designer + user-added agents) get a "Planned" badge, sit in a collapsed "Planned agents" group, and lose
   pause/workers controls; Workflows: schedules and "Run now" hidden with an honest note (no scheduler yet), templates
   as plain reference; Settings: "Maximum parallel workers" and "Require approval before content publishes" removed
   outside demo (or marked clearly as not applicable: jobs run one at a time; nothing publishes without build
   approval); Review "Review mode by site" hidden outside demo; "Refresh search volumes" goal removed outside demo;
   Analytics note about agents stopping at budget corrected; Workspace MissingKey copy fixed (keys can be stored);
   Rank/GA4/empty promises reworded to what is true today; Skills "Instructions" field either saved or removed; remove
   the unused `Placeholder.tsx`.
5. Keep every existing test meaningful (update expectations where the UI legitimately changed) and add tests for the
   checklist, the Empty component, status vocabulary, planned agents, and the date format.

## Phase 2 (starts after phase 1 is merged; separate briefing)
C. Spend ledger + enforced budget + real spend/tokens in Analytics, Sites and Workspace.
E. Article editor (edit before approval), bulk write, bulk approve, unapprove.
F. Password reset by email, audit log filters/pagination/CSV export, in-app notifications for blocked/budget/report.

## Phase 2 briefing (phase 1 is merged and live; all ground rules above still apply)

State after phase 1: server suite 237 tests, app suite 375 tests, all passing. Jobs: `server/jobs.ts` (`addJobSource`,
`queueSnapshot`, caps), prompts carry JSON-quoted data, `POST /api/requests|articles` use `siteInfo`, reviewers get a
filtered workspace, audit entries posted by the app carry `note: true`, `server/log.ts` logs job lifecycle,
`server/system-api.ts` has health/backup. App: `Empty` takes icon/title/action, `Table` has `loading`, `stamp()` is the
date format, agents without a runner are "Planned", Analytics spend/token charts were removed outside demo (package C
brings them back with real data), Review "Drafts"/"Review mode" hidden outside demo.
Shared files in phase 2 (additive, re-read before editing): `server/main.ts`, `server/articles.ts`, `server/schema.ts`,
`server/migrate.ts`, `app/src/store/types.ts`, `app/src/store/live.ts`, `app/src/router.tsx`, `README.md`, `app/PORTING.md`.

### C. Spend ledger, enforced budget, real spend and tokens
Owns: new `server/ledger.ts` (+ test), `server/notify.ts`, `server/report.ts`, `server/requests.ts`, `server/photos.ts`,
`server/builds.ts` (cost recording only), `server/photos-api.ts`, `app/src/views/Analytics.tsx`,
`app/src/store/serverFacts.ts`, new `app/src/store/spend.ts`; minimal edits in `server/articles.ts` (record runs; budget
check in createArticle/revise/retry), `server/main.ts` (budget check on POST /api/requests + retry; `spend` in
/api/state; router), `app/src/views/Settings.tsx` (budget wording), `app/src/views/sites/SitesTable.tsx` (spend column).
1. `job_runs` ledger: one row per CLI invocation (kind, job id, site id, agent, model, started, ended, tokens, cost,
   outcome ok|failed|timeout|cancelled). Record failures and timeouts too when the CLI reported usage; revisions and
   retries add rows instead of overwriting. Backfill once from existing requests/articles/photo/build costs.
2. Spend = sum of the ledger: per site today (local day, keep using the server clock), last 7 and 28 days, per agent
   today; `siteSpendToday`, the budget alert and the report read the ledger (fixes double counting).
3. Enforced budget: Settings "Daily budget per site (USD)" is a hard stop — when a site's spend today ≥ budget, new
   agent jobs for that site (research, article, revision, retry, find photos, first-build identity) are refused with
   409 "kopi.example has used its daily budget of $25.00. It resets at midnight, or raise the budget in Settings."
   Jobs already queued when the limit is hit are held (not failed) and start again the next day or when the budget is
   raised: show them as "Waiting for budget". Alert at 80% stays; add an alert at 100% ("stopped").
4. API: `spend` in `GET /api/state` (per site: today, d7, d28, tokens28; per agent today: tokens, cost; budget) and an
   event `spend` when a run is recorded. App: `site.spend`/`tok28`, agent tokens today, Workspace "Tokens today" KPI
   (restore it next to the others), Analytics overview charts with real numbers (spend against budget per site, tokens
   per agent, tokens per site 28 days), Sites "Spend today" column, Run history cost stays. Honest empty states.
5. Settings copy: the budget now stops jobs — say so. Tests for all of it (server + app).

### E. Article editor, bulk actions, unapprove
Owns: `server/article-api.ts`, new `server/article-edit.ts` (+ test), `server/checks.ts`, `app/src/views/content/*`,
`app/src/views/Review.tsx`, `app/src/views/research/KwResultSheet.tsx`, `WriteArticleSheet.tsx`,
`app/src/store/slices/content.ts`, `app/src/store/serverApi.ts`, `app/src/store/liveArticleApply.ts`; minimal additive
edits in `server/articles.ts` (new statements/functions only).
1. Edit before approval: `PATCH /api/articles/:id/content` (admin, editor; article in review) for title, title tag, meta
   description, slug and blocks (text of h2/h3/p, list items, table cells; add/remove/reorder blocks), in the site
   language only (the English reviewer translation of an edited block is marked "edited, translation not updated").
   Same limits and sanitising as `parseArticle`; optimistic check on `updatedAt` (409 when the article changed
   meanwhile); recompute checks; history event `edited` with what changed; a language review done before the edit is
   cleared when body text changed. UI: an "Edit" mode in the article detail with inline fields, Save/Cancel, unsaved
   warning, keyboard friendly; photos keep their positions sensibly when blocks move or are removed.
2. Stronger automatic checks (server, in checks.ts): title tag length (warn > 60 chars), meta description length (warn
   outside 70–160), slug duplicates within the site (bad), title duplicates within the site (warn), fewer than 2
   sources (warn), body under 300 words (warn), phrases that claim first-hand testing ("kami menguji", "we tested" —
   small per-language list, warn). Keep "bad" only for what must block approval.
3. Bulk: `POST /api/articles/bulk` { requestId, keywords[] } (max 10 per call, respects the queue caps and the budget
   stop if `server/ledger.ts` exports `budgetStop` — import defensively) with per-keyword results; checkboxes +
   "Write selected (n)" in the keyword result sheet; Review: select several waiting articles → "Approve selected"
   (each still needs its language review when `native` is on; show which were skipped and why).
4. Unapprove: `POST /api/articles/:id/unapprove` (admin, editor) sends an approved article back to review (history
   event; the next build no longer includes it; a live build is not changed — say so in the UI). Also `archive` for
   rejected/approved articles (hidden from lists by default, "Show archived" toggle).
5. Tests (server + app) for all of it.

### F. Accounts, audit and in-app alerts
Owns: `server/auth-api.ts`, new `server/reset.ts` (+ test), `server/workspace-api.ts`, new `server/audit-api.ts` if
useful, `app/src/shell/*`, `app/src/views/Audit.tsx`, `app/src/views/Team.tsx`, `app/src/store/liveNotifs.ts`,
`app/src/store/authApi.ts`, `app/src/store/auth.ts`; additive: `app/src/router.tsx` (reset route), `server/main.ts`.
1. Password reset by email: "Forgot your password?" on Sign in → `POST /api/auth/reset/request` (always answers the
   same; throttled per email and globally) emails a one-time link `/reset/<token>` (32-byte token, only its hash stored,
   30 minutes, single use) when Email (SMTP) is set up and usable; `/reset/<token>` page sets a new password (same
   rules), ends all that person's sessions, audit entry, and an email "your password was changed". When SMTP is not set
   up, the sign-in screen keeps the current "ask an admin" text. An admin can also create a reset link for a person in
   Team (shown once with Copy, like invitations) — this is the owner-lockout recovery path when there is a second admin.
   2-step stays required after a reset.
2. Admin view of everyone's sessions in Team (device, last seen) with "Sign out" per session and "Sign out everywhere"
   per person.
3. Audit log: server pagination (`GET /api/audit?before=<id>&limit=100&actor=&site=&q=&from=&to=`), filters in the UI
   (actor, site, text, date range), "Load more", and CSV export (`GET /api/audit.csv` with the same filters, admin and
   editor; safe against CSV formula injection: prefix cells starting with = + - @ with a single quote).
4. In-app notifications (bell) for: a domain blocked or down (from access checks), budget alerts and the weekly report
   sent — served from the server's `alerts` table through a small read route for signed-in non-reviewers, respecting
   the "In-app" column of the alert table and the per-person read state that exists today.
5. Tests (server + app) for all of it.
