# Meridian iteration 2: workflows, internal links, insights data, custom domains

Project root: `/Users/ranggaoctaviyanto/Documents/projects/meridian`. Node: `<root>/.tools/node/bin` (first on PATH).
Read first: `README.md`, `app/PORTING.md` (sections 14-20 and the nav section), `docs/audit-2026-10-product.md`
(sections 1-3 and the roadmap) and `docs/audit-2026-10-screens.md`.

## Ground rules (every package)

- NOT a git repo: never run git. Never delete files you do not own.
- **Never touch `data/` and never stop, restart or signal the live server on port 4310.** Never use `pkill`/`killall` or
  any pattern kill: stop only processes you started, by PID. Throwaway servers: free port + temp `MERIDIAN_DATA` + the
  fake CLI and fake services (`server/testkit.ts`, `server/fixtures/`), cleaned up afterwards.
- Do NOT run `npm run build`. No real paid CLI jobs, no real calls to Google, Cloudflare, DataForSEO or email: tests use
  the fakes (extend `server/fixtures/fake-services.ts`, `fake-cloudflare.ts`, add `fake-*.ts` as needed; service base
  URLs come from `server/net.ts` `base()`).
- Server: Node 24, TypeScript run directly (no enums/namespaces/parameter properties), `node:sqlite`, no npm packages.
  App: React 19 + Zustand/immer + TanStack; no new npm deps.
- Normal mode shows only real data and working controls; demo mode keeps the prototype behaviour. UI text: English,
  sentence case, plain words. A feature that needs an account the user has not connected says so and what to do.
- Keep the security model: `x-meridian: 1` on writes, session cookie, role checks (`mayWrite`, `mayAdmin`, `seesSite`,
  reviewer scoping), agent tool rules scoped as in `server/engine.ts`/`writer.ts` (no bare Read, prompts carry
  JSON-quoted data), secrets only through `integrations.ts`/`vault.ts`, outbound calls through `net.ts`.
- Every paid agent job goes through the existing queue (`jobs.ts`), the ledger (`ledger.ts` records each CLI run) and
  the budget stop (`budgetStop`). Schema changes go in `schema.ts` + `migrate.ts` and keep existing data.
- Nothing publishes or deploys without the human approvals that exist today.
- Tests: server `npm run test:server` (root); server type-check
  `app/node_modules/.bin/tsc -p /private/tmp/claude-501/-Users-ranggaoctaviyanto-Documents-projects-meridian/355ab15a-3378-4ad3-ae5b-aa6cd137489d/scratchpad/tsconfig.server.json`;
  app `npm run typecheck` and `npx vitest run` in `app/`. Baseline: 304 server tests, 480 app tests, all passing.
  Everything must pass when you finish; add tests for what you build.
- Four packages run at the same time. Only edit files your package owns, plus the shared files with minimal additive
  edits (re-read right before editing; if an Edit fails, re-read and retry). Shared: `server/main.ts`, `schema.ts`,
  `migrate.ts`, `migrate.test.ts`, `stream.ts`, `builds.ts`, `fixtures/fake-services.ts`, `app/src/store/types.ts`,
  `live.ts`, `seed.ts` (emptyLive), `README.md`, `app/PORTING.md`.
- Final answer: what you built, files changed, exact test counts, what is left open or needs the lead. A wrap-up
  instruction can only come from the lead via a direct message.

## G. Workflow engine and schedules
Owns: new `server/workflows.ts`, `server/workflow-api.ts`, tests; `app/src/views/Workflows.tsx`, new
`app/src/views/workflows/*`, `app/src/store/slices/sites.ts` (schedule/run actions), new `app/src/store/workflowApi.ts`,
`app/src/store/liveWorkflows.ts`.
1. `workflow_runs` table + a small state machine in code (no LLM orchestrator): **Weekly content** for a site =
   keyword research (topic = site topic, or the schedule's topic) → pick the top N keywords without an article
   (N per schedule, 1–5, default 2; with volumes when package I has stored them, else the agent's order) → queue
   articles → wait for human review (approved or rejected ends that article's part) → when at least one new article
   is approved, queue a website build → wait for build approval → deploy if Cloudflare is connected → done. Each step
   records what it did; a failed step fails the run with the reason; a budget stop holds the run ("Waiting for
   budget") and resumes; a run can be cancelled (queued jobs it created that have not started are withdrawn).
   Use the existing functions for creating requests/articles/builds (call them; do not copy their logic); if a
   function you need is not exported, add a small exported wrapper in its file (additive).
2. Schedules are real: the `schedules` workspace document drives the engine (cadence: weekly on a weekday + hour,
   every 2 weeks, monthly; site; N; on/off). The scheduler ticks every minute, uses the site's time zone derived from
   its country (small table; default the server's), starts a due run once (persisted `last_due` so a restart never
   double-fires, a schedule more than 6 hours late is skipped and says so), never starts a second run for a site that
   already has one running. "Run now" starts it immediately. "New schedule" and "Run workflow" buttons in the
   Workflows tab; schedules can be edited and removed.
3. "Domain access check" as a schedule template is already covered by the 6-hourly recheck: show it as a read-only row
   ("Every 6 hours for live sites") instead of a fake schedule.
4. API: `GET /api/workflows` (runs + next due times), `POST /api/workflows` (run now), `POST /api/workflows/:id/cancel`,
   SSE event `workflow`. App: the Workflows tab shows running and recent runs with their steps (which step, since
   when, what it waits for, links to the article/build it is waiting on), schedules with next run time, and the
   Workspace shows a running workflow in the pipeline/activity where it fits. Orchestrator agent: it becomes a real
   (non-"Planned") agent whose desk shows the running workflow step ("Weekly content for kopi.example · waiting for
   your review of 2 articles"); it makes no CLI call.
5. Tests: full run with the fake CLI through every state including the human waits; due-time logic across time
   zones and restarts; cancel; budget hold; role checks.

## H. Internal links and categories
Owns: `server/writer.ts`, `server/article-content.ts`, `server/sitebuild.ts`, `server/article-edit.ts` (links in
edits), `server/checks.ts`, new `server/links.ts` + tests; `app/src/views/content/LiveArticleBody.tsx`,
`ArticleEditor.tsx`, `editing.ts`; `app/src/views/Links.tsx`, `views/research/graph.ts`, `LinkGraph.tsx`,
`views/Architecture.tsx`, `views/research/SiloTreeSection.tsx`, `siloTree.ts`. Additive in `server/builds.ts`
(pass categories/links into `buildSite`).
1. Inline links in article text: paragraphs and list items may carry links as a safe structure (text with link
   spans: `{ text, links?: [{ start, end, to }] }` or a similar explicit form — never raw HTML), where `to` is either
   another article of the same site (by article id, resolved to its URL at build time) or an http(s) source URL.
   `parseArticle` validates (ranges inside the text, no overlaps, internal targets exist and are on the same site,
   at most ~8 links per article); the editor can add/remove a link on selected text (internal article picker or URL);
   the dashboard and the built site render them (`<a href>` relative for internal, plain for external; descriptive
   anchors — the check warns on "click here"/"read more"/"di sini").
2. The Content Writer gets the site's approved and in-review articles (id, title, slug, one-line summary, category)
   as JSON-quoted data and is told to link to the relevant ones in context (2–5 where they truly help, never forced),
   and to propose a category for the article from the site's existing categories or a new short one. Category is
   stored on the article (`category` column; default = the keyword's research cluster when there is one) and editable
   in the editor.
3. Built site: category pages (`/<category-slug>/` listing its articles), three-level breadcrumbs (Home › Category ›
   Article) with matching `BreadcrumbList`, a "Related articles" block (same category first, then newest; descriptive
   anchors), categories in the home page and navigation when there are at least two, sitemap includes category pages.
   An internal link to an article that is not in this build (not approved) is rendered as plain text. Validation in
   the build's check step covers the new links and pages.
4. A deterministic `links.ts`: for a site, the real link graph (article → article), orphans (no inbound links), and
   categories with counts. API `GET /api/sites/:id/links`. The Internal links tab draws the real graph outside demo
   mode and lists orphans with a "Write a link" hint; the Architecture tab shows the real category tree (categories →
   articles) with counts and lets an editor rename or merge categories.
5. Tests for parsing/validation (hostile input), rendering/escaping, build output, graph, editor operations.

## I. Insights data: Search Console detail, rank tracking, keyword volumes, GA4
Owns: `server/google.ts`, `server/metrics.ts`, new `server/dataforseo.ts`, new `server/rank.ts`, `server/requests.ts`
(volume step after the agent's result), `server/connectors.ts`, `server/fixtures/fake-google.ts` (new) and
DataForSEO fake routes; `app/src/views/Rank.tsx`, `views/research/RankHeat.tsx`, `heatData.ts`, `views/Analytics.tsx`
(Search Console and GA4 tabs only), `views/system/SourceTab.tsx`, `views/research/KwRequests.tsx`, `KwResultSheet.tsx`
(volume columns only; package H does not touch these), `app/src/store/serverFacts.ts`, `liveApply.ts`.
1. Search Console per page and per query: daily fetch (and on connect / manual refresh) of the last 28 days with
   `page` and `query` dimensions per site property; stored in `gsc_rows` (site, date, page, query, clicks,
   impressions, position), retention 16 months; `GET /api/metrics/site/:id` (top pages, top queries, totals by day).
   The Search Console tab shows per-site totals, a daily clicks chart, top pages and top queries.
2. Rank tracking: the tracked keywords of a site are the keywords of its approved articles (and research keywords
   marked "track"); position now, 7-day and 28-day change, best page, from `gsc_rows`. The Rank tab fills its table and
   heat map from this outside demo mode. Build and deploy timeline gets the real "rank effect": average position
   change of the site's tracked keywords 7 days after a deploy vs the 7 days before (shown only when both windows have
   data). Honest empty states: "Search Console is not connected" / "No data yet: Google needs a few days after a site
   goes live".
3. Keyword volumes: when DataForSEO is connected and usable, after the Keyword agent proposes keywords the server
   fetches search volume and competition for them (one batched request per research; location from the site's
   country; language from the site) and stores `volume`, `competition`, `volume_at` on the keywords; the keyword
   tables show Volume (and hide it when no site has volumes); "Refresh volumes" on a finished research. Cost of the
   DataForSEO call (from its response) is recorded in the ledger as a non-CLI run when the ledger allows (else in
   `requests.notes`). Without DataForSEO everything stays as today.
4. GA4: map each site to a property (auto-match by domain from `accountSummaries` + data streams; a select in the
   Analytics > GA4 tab to choose when it cannot be matched), daily `runReport` (users, sessions, engaged sessions by
   date and by page for 28 days) into `ga4_rows`; the GA4 tab shows them. Honest states when not connected.
5. Tests against fakes for all four (token refresh, paging, API errors, quota errors, mapping), plus app tests.

## J. Custom domain automation and site status
Owns: `server/cfpages.ts`, `server/fixtures/fake-cloudflare.ts`, new `server/domains.ts` + tests; the deploy part of
`server/builds.ts`; `server/integrations.ts` (cf help text), `server/connectors.ts` is package I's: ask via your
report if a change is needed there; `app/src/views/deploy/*`, `app/src/views/sites/SitesTable.tsx`, `VerifySheet.tsx`.
1. After a successful production deploy, attach the site's domain to the Pages project (`POST …/domains`), and when
   the domain's zone is in the same Cloudflare account and the token may edit DNS, create/repair the CNAME (apex or
   `www`, proxied) — never overwrite an unrelated existing record: report it and stop. Poll domain validation and
   certificate status (`initializing → pending → active`, errors with Cloudflare's message) in the background with
   backoff, for up to 24 hours, surviving restarts. When the zone is elsewhere, show the exact DNS record the user
   must add at their DNS provider and re-check on demand.
2. Domain state per site (`site_domains`: status, validation method/TXT, last error, checked at) exposed in
   `GET /api/state` and by event; the Build and deploy Website card shows a "Domain" step: Not attached → Waiting for
   DNS → Issuing certificate → Live on https://domain, with a "Check again" button and plain-English errors (token
   lacks DNS: Edit; zone not in this account; CAA blocks issuance; domain already used by another project).
3. When the domain is active and the site answers over HTTPS (one request from this computer), the site's status in
   the sites document becomes `live` (server-side write through the existing document functions, with an audit entry
   and a `workspace` event) — this also turns on the 6-hourly access recheck; a first access check is queued. A site
   whose deploy is only on `*.pages.dev` stays "Being set up" and the card says the pages.dev address works already.
4. Rollback/deploy of an older build keeps the domain attached. Removing a site does not delete the Pages project or
   DNS (say so in the confirm dialog).
5. Tests with the fake Cloudflare for every branch (zone in account, zone elsewhere, token without DNS permission,
   existing conflicting record, validation error, restart while pending).
