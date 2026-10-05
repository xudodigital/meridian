# Meridian server audit: robustness and operability

Read-only audit: no project files were edited, no git, and nothing in `data/` was written or opened (only `ls`/`du`). I exercised a throwaway server on port 4399 with a temp data folder and the fake CLI; scripts are in `<scratchpad>/audit/`.

**One thing to know first.** My throwaway server died silently at about 20:39 local, and the real server on 4310 was restarted at 20:39:38 by `./start.sh` from the main Claude session (pid 70475). None of my commands targeted either process. Another throwaway server (port 4477, another agent's scratchpad) started at 20:39:16, so a broad kill by a sibling agent is the likely cause, but I could not confirm it. The server logs nothing on exit, so there is no trace.

All paths below are under `/Users/ranggaoctaviyanto/Documents/projects/meridian/`.

## Findings, by priority

### High

**H1. A brief database lock crashes the whole server, and nothing restarts it.**
- **Where:** `server/db.ts:9`, `server/jobs.ts:19,27-33`, `server/requests.ts:39-42`, `server/main.ts:184`.
- **Evidence:** `PRAGMA busy_timeout` is 0. I queued a job and held `BEGIN IMMEDIATE` from a second process for 5 s. The server died with `Error: database is locked at addStep (steps.ts:18) at runRequest (requests.ts:41) at async next (jobs.ts:31)`.
- **Cause:** the job's `catch` block itself writes to the database, so it throws again. `void next()` has no catch, and there is no `unhandledRejection` handler.
- **Reach:** the same path applies to disk-full, and to any error in the timers (`notify.ts:189`, `report.ts:123`).
- **Fix:**
  - Open with `new DatabaseSync(path, { timeout: 5000 })`.
  - Wrap `next()` in a catch that logs and continues.
  - Make failure handlers tolerate their own write failing.
  - Add `process.on('uncaughtException' | 'unhandledRejection')` that logs, then exits non-zero.
  - Run under a supervisor (see O6).

**H2. No backup or restore, and the live database is almost entirely in the WAL.**
- **Where:** `server/schema.ts:262`, `README.md:117`.
- **Evidence:** the real `data/meridian.db` is 4,096 bytes (one page, last modified Oct 2), while `meridian.db-wal` is 3.6 MB. It was still 4 KB after the 20:39 restart.
- **Impact:**
  - Copying `meridian.db` alone yields an empty database.
  - Copying the folder while the server runs can give an inconsistent pair.
  - Losing `secret.key` makes every stored secret and 2-step secret unreadable.
  - The README only says to keep `secret.key` with "every backup of `data/`"; there is no command for it.
- **Fix:**
  - Add a backup command using `VACUUM INTO` (or `node:sqlite`'s `backup()` if this Node has it), bundling `secret.key`, `media/` and `sites/` into one archive.
  - Add a matching restore command.
  - Take a nightly snapshot with rotation.
  - Run `PRAGMA wal_checkpoint(TRUNCATE)` and `db.close()` on shutdown.

**H3. A CLI process that ignores SIGTERM blocks the queue forever, and child processes are orphaned.**
- **Where:** `server/engine.ts:54-65`.
- **Evidence:** I ran `runClaude` against a stub that traps SIGTERM, with a 2 s timeout. It never resolved (`STILL WAITING after 8s`). After the parent exited, the stub and its grandchild (`sleep 300`) were still running.
- **Cause:** `run()` resolves only on `close`; there is no SIGKILL escalation and no process-group kill. Because the queue runs one job at a time, one stuck child stops everything.
- **Fix:**
  - Spawn with `detached: true` and kill the group with `process.kill(-pid, …)`.
  - Send SIGKILL after about 5 s.
  - Resolve after a hard deadline regardless.
  - Record the child's pid in the database and kill leftovers in `recover()`.

**H4. Non-ASCII CLI output is corrupted at chunk boundaries.**
- **Where:** `server/engine.ts:60-61` (`out += d` on Buffers).
- **Evidence:** a stub printing about 600 KB of Japanese text through `runClaude` came back with 15 U+FFFD replacement characters and the wrong length.
- **Impact:** articles in Thai, Japanese, Vietnamese and similar can be silently damaged whenever stdout arrives in more than one chunk.
- **Fix:** call `child.stdout.setEncoding('utf8')` (and the same for stderr), or collect Buffers and decode once.

**H5. Shutdown is not graceful.**
- **Where:** `server/main.ts:184`, `server/jobs.ts:38`.
- **Evidence:** I sent SIGTERM mid-job. The process exited at once. The request row stayed `status: 'work'` with no "stopped" step, and nothing was logged. On restart, `recover()` re-ran it silently.
- **Impact:**
  - The database is never closed (see H2).
  - In-flight responses are cut.
  - The child is not awaited.
  - The run is paid for twice.
- **Fix:**
  1. Stop accepting requests and close SSE streams with a "restarting" event.
  2. Abort the job and wait up to about 10 s for the child.
  3. Requeue the job explicitly with a "Server stopped" step.
  4. Checkpoint, close the database, log, and exit.
  5. Also handle SIGHUP.

**H6. One FIFO queue for everything, with no priority, cancel or attempt limit.**
- **Where:** `server/jobs.ts:22-33`, `server/writer.ts:15-16`, `server/photos.ts:342,351`, `server/builds.ts:76-77`.
- **Evidence:** with three requests queued, two sat `queued` behind one `work`.
- **Impact:** an article job (15 minutes, 60 turns) or a photo job (two CLI calls plus downloads) delays a 2-second deploy or rollback and a 6-minute keyword job. I found no cancel route, and no automatic retry or backoff. `recover()` requeues with no attempt counter, so under a supervisor a job that kills the server would loop.
- **Fix:**
  - Two lanes: model jobs, and builds/deploys that make no model call.
  - Put deploys first.
  - Add an `attempts` column and fail after 2 recoveries.
  - Add `POST /api/jobs/:kind/:id/cancel`.

### Medium

**M1. Almost no logging.**
- **Where:** six `console.*` calls in total (`main.ts:161,169,180,181`, `photos.ts:483`, `probe.ts:218`).
- **Evidence:** no timestamps, request log, job start/finish/cost lines, shutdown line, file or rotation. `start.sh` writes to the terminal only.
- **Positive:** bodies are never logged and tokens in paths are masked (`main.ts:161`).
- **Fix:** a small JSON-lines logger to `data/logs/meridian.log` with size rotation. Log request method, path, status and duration, job lifecycle, scheduler ticks, and start/stop with version.

**M2. Health check is shallow and there is no version endpoint.**
- **Where:** `server/main.ts:59`.
- **Evidence:** `/api/health` returns `{"ok":true}` without touching the database. `/api/version` returns 401. `package.json` says 0.1.0 while the User-Agent says `Meridian/1.0` (`net.ts:46`).
- **Fix:**
  - Keep the open route minimal.
  - Add an admin `/api/health/detail` with version, uptime, `SELECT 1`, queue depth and running job age, engine status, disk free, database and WAL size, last backup, and last scheduler ticks.

**M3. Startup checks are missing.**
- **Evidence:**
  - A second instance on the same port dies with a raw `EADDRINUSE` stack.
  - An unwritable data folder dies with a raw `EACCES` stack at `db.ts:8`.
  - `start.sh:5` checks only that `node` exists, not that it is version 24.
  - A wrong `MERIDIAN_CLAUDE_BIN` silently fell back to the real CLI 2.1.284 (`engine.ts:36-37`).
  - Nothing stops two instances on different ports sharing one data folder; both would run `recover()` and the queue, and hit H1.
- **Fix:** a preflight with plain-English messages, a `data/meridian.lock` pid file, a `server.on('error')` handler, a Node version check in both `start.sh` and `main.ts`, and a warning when `MERIDIAN_CLAUDE_BIN` is set but missing.

**M4. Disk growth outside `data/` that nothing cleans.**
- **Where:** `server/engine.ts:122,202`, `server/writer.ts:94`, `server/photos.ts:397`, `server/builds.ts:335`.
- **Evidence:** each job gets its own working folder, so the CLI keeps a transcript folder per job under `~/.claude/projects/…-meridian-data-workspaces-<kind>-<id>`. Seven exist, 140 to 816 KB each. They hold full prompts and article text and sit outside any `data/` backup. `data/workspaces/*` folders are never removed. `*.zip.<pid>.tmp` files left by a crash are never swept (`zip.ts:108`).
- **Fix:** delete the working folder after each job, use one fixed working folder per job kind, and sweep old transcript folders and temp files at start.

**M5. Cost accounting under-reports and the budget is advisory.**
- **Where:** `server/engine.ts:124-134`, `server/db.ts:42,66`, `server/notify.ts:147-166`.
- **Evidence (code reading):**
  - Timed-out, cancelled and errored runs throw before usage is read, so their cost is never stored.
  - `fail` does not reset `cost_usd`, so a failed revision keeps the previous run's cost under a new `finished_at` and is counted again as today's spend.
  - Cost is "of the latest job", so revisions and retries overwrite history.
  - The budget only raises an alert at 80%; nothing refuses jobs.
- **Fix:** a `job_runs` ledger with one row per CLI invocation (including failures), spend summed from it, and an optional hard stop at 100%.

**M6. The prompt is passed as a command-line argument.**
- **Where:** `server/engine.ts:107`.
- **Evidence:** `pgrep -fl` showed the full prompt. Any local user can read it with `ps`, and a revision prompt carrying the previous article counts against the OS argument limit.
- **Fix:** send the prompt on stdin.

**M7. Alerts and reports are not retried.**
- **Where:** `server/notify.ts:133`, `server/report.ts:116`.
- **Evidence (code reading):** every pending alert is marked sent even when the channel threw. The report's due marker is saved before sending.
- **Fix:** per-channel delivery state with up to 5 backed-off retries; move the due marker after a successful send.

**M8. Retention and visibility.**
- **Where:** `server/db.ts:36,58`, `server/builds.ts:54`, `server/workspace.ts:112,115-118`.
- **Evidence (code reading):**
  - Lists are capped (requests 100, articles 200, builds 100, audit 200) with no pagination or export, so older rows become unreachable.
  - `audit_log`, `article_events`, used invites, and `requests`/`articles`/`keywords` grow without bound.
  - "Reset workspace" wipes the audit log, although README line 57 says it cannot be deleted through the API.
  - There is no VACUUM.
- **Already bounded:** alerts (90 days), access checks (50 per site), job steps (latest run only), builds on disk (10 per site).
- **Fix:** a nightly maintenance job that archives old audit rows to a CSV, runs `PRAGMA optimize` and an occasional VACUUM, plus cursor pagination and CSV export.

**M9. Schema migrations only add columns.**
- **Where:** `server/migrate.ts:14-32`, `server/schema.ts:261-265`.
- **Evidence:** `user_version` is 0. There is no transaction, no pre-upgrade backup, and no guard against older code opening a newer database.
- **Fix:** numbered migrations in a transaction, a snapshot before any pending migration, and a refusal to start when the database is newer than the code.

**M10. All time logic uses the host's time zone.**
- **Where:** `server/notify.ts:44-51,144,155`, `server/report.ts:101-108`.
- **Evidence:** at the same instant, `quietNow` is false under `Asia/Jakarta` and true under `Asia/Tokyo`, and "Monday 08:00" is 01:00Z versus 23:00Z the day before.
- **Fix:** a `timezone` setting (IANA name) applied through `Intl.DateTimeFormat`, shown in Settings.

**M11. The sign-in limiter is keyed on the socket address.**
- **Where:** `server/http.ts:47`, `server/limits.ts:7`.
- **Evidence:** 21 wrong sign-ins for random emails from 127.0.0.1, then the owner with the correct password got 429 "Try again in 5 minutes".
- **Impact:** any local process, or everyone behind one proxy, can lock out all users.
- **Fix:** use X-Forwarded-For only from a configured trusted proxy.

**M12. Configuration is environment variables only.**
- **Where:** README lines 171-175 list five. The code also reads `MERIDIAN_URL_*` (`net.ts:24`), `MERIDIAN_MEDIA_HOSTS`, `MERIDIAN_ALLOW_LOCAL_HOOKS` (`integrations.ts:118`) and `MERIDIAN_PROBE_POLL_MS`.
- **Risk:** the `MERIDIAN_URL_*` test overrides are live in production; a stray one sends API keys to another host. Timeouts, turn limits, keep counts and the host are all constants.
- **Fix:** a validated `data/config.json` with env override, the effective config logged at start, and `MERIDIAN_URL_*` honoured only with an explicit test flag.

### Low

- **File permissions:** `data/` is 755 and `meridian.db` is 644 (password hashes, emails, sealed secrets); only `secret.key` is 600. Use 700 and 600.
- **Oversized bodies:** above about 5 MB the connection is destroyed (`http.ts:22`). A 200 MB upload was cut at 6.8 MB with no 413, and the server logged `Request failed … Premature close`.
- **Engine probing:** `engineStatus(true)` spawns two CLI processes before every job and every 15 s per `/api/state` (`engine.ts:68-83`, `events.ts:10`).
- **Slow CLI:** a slow `auth status` (20 s timeout) reads as "not signed in" and fails the job.
- **Network calls:** timeouts are good throughout (`net.ts:52`, `smtp.ts:27,75`, `commons.ts:269,338`). Retries exist only for Cloudflare and Commons; Globalping, Search Console, Slack and Telegram get one attempt.
- **Optimistic concurrency:** works. A stale PUT returned "Someone else changed this at the same time." with the current version and data. It is whole-document, so two people editing different sites still conflict.
- **SSE:** the 25 s ping and `retry: 3000` are fine. There is no `Last-Event-ID` replay, so the page must refetch state after reconnecting.
- **Test gaps:** no tests for `recover()`, SIGTERM mid-job, CLI timeout or hang, CLI output over 64 KB or non-ASCII, a locked database, port in use, two instances, quiet hours and report schedule across time zones, alert retry, or pagination caps. The tests also write the server's database from the test process with a busy timeout of 0, which can trigger H1 and cause flaky runs.

## LAN access

### What breaks today behind a proxy (tested)
- **Host preserved:** `Host: meridian.lan` or a LAN IP returns 403 "Not allowed." (`http.ts:34-36`).
- **Host rewritten to 127.0.0.1:** reads work, but every write with `Origin: https://meridian.lan` returns 403 (`http.ts:42`).
- **Lockout:** all users share one address for the limiter (M11).
- **Links:** always `http://localhost:PORT` in alerts (`notify.ts:53`) and the Google redirect (`google.ts:18`); invite links are forced to `http://` (`team-api.ts:38`).
- **Cookie:** no `Secure` flag (`sessions.ts:82`).
- **Live updates:** no `X-Accel-Buffering: no` on the event stream (`stream.ts:39`), so nginx will buffer it.
- **App shell:** has no CSP (`main.ts:133-140`).

### What a safe "share on the LAN" option needs
1. An explicit opt-in (`lan: true`, bind address); never the default.
2. HTTPS only, with an HTTP-to-HTTPS redirect. The certificate can come from `openssl` at first run (SANs for `<hostname>.local` and LAN IPs), a user-supplied pair, or Caddy / Tailscale Serve, which avoids per-device warnings.
3. A configured Host allow-list replacing the regex, keeping the DNS-rebinding refusal.
4. A `publicUrl` setting used for every generated link and for the Origin check.
5. A `__Host-meridian_session` cookie with `Secure`, plus HSTS.
6. A trusted-proxy setting for the client address.
7. Mandatory 2-step verification while LAN mode is on, and a CSP on the app.
8. Google sign-in stays on the host machine unless `publicUrl` is an https name Google accepts.
9. Finer queue fairness (H6) and a per-user job cap.
10. README line 163 already notes that the Claude subscription is for personal use; team use should move to the API.

## Top 8 operability improvements

| # | Improvement | Effort |
|---|---|---|
| O1 | Backup and restore: command plus a Settings button, nightly snapshot with rotation, snapshot before upgrade, "last backup" in health (H2) | M |
| O2 | Crash-proofing: busy timeout, guarded job runner and timers, global handlers, SIGKILL escalation, process-group kill, UTF-8 decoding (H1, H3, H4) | S |
| O3 | Graceful shutdown: drain, requeue with a step, checkpoint, close, log; lock file against double start; friendly preflight errors (H5, M3) | S |
| O4 | Structured log file with rotation: requests, job lifecycle with cost, schedulers, start/stop with version (M1) | S |
| O5 | Health and version: admin detail endpoint plus a Settings "System" card (M2) | S |
| O6 | Service install: `./service.sh install/uninstall` writing a launchd plist with KeepAlive and log paths; an attempt cap so a bad job cannot crash-loop (H6) | M |
| O7 | Nightly maintenance: prune work folders, CLI transcripts and temp files; archive the audit log; optimize and vacuum; pagination and CSV export; per-run cost ledger with optional hard budget stop (M4, M5, M8) | M |
| O8 | Config file and queue lanes: validated `data/config.json` (port, bind, public URL, time zone, timeouts, retention, LAN/TLS), numbered migrations, a separate lane and priority for deploys, a cancel route (M9, M10, M12, H6) | L |