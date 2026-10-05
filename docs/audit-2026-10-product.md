# Meridian gap analysis (read-only audit)

Nothing was edited, git was not run, and `data/` and the server on port 4310 were not touched. One caveat: the background catalog of all 18 screens had not returned when I wrote this. Everything below comes from files I or the server audit read directly. I did not read Team, Integrations, Skills, History or the Workspace internals line by line, so section 1 may miss small demo-only details on those screens.

Paths are relative to `/Users/ranggaoctaviyanto/Documents/projects/meridian/`.

## The headline

The real pipeline is narrow and works: keyword ideas → one article → human review → photos → static build → approval → Cloudflare Pages. Around it sit about ten screens and a dozen settings that render, save and write audit lines but have no effect on the server. For a boss, the biggest risk is not missing features. It is controls that look live and are not: budget, parallel workers, review modes, schedules, "Run now", agent pause and skill assignment.

## 1. What demo mode shows and normal mode lacks

Demo data is in `app/src/store/seed.ts`; the empty state is `app/src/store/empty.ts`. The module tables (`mod.*`) are emptied in normal mode and only `keywords`, `factory` and `gsc` are ever refilled (`app/src/store/liveApply.ts:50`, `app/src/store/serverFacts.ts:38-48`).

| # | Demo shows | Normal mode today | Evidence |
|---|---|---|---|
| 1.1 | Rank tracking table and heat map | Always empty. The empty text promises data "once Search Console is connected and a site has traffic", but nothing ever fills it | `app/src/store/constants.ts:111`, `app/src/views/research/RankHeat.tsx:14`; no rank table in `server/schema.ts` |
| 1.2 | Deploy timeline "Up 2.1 positions after 7 days" | Real timeline has no rank effect | `seed.ts:186`, `app/src/views/sites/DeployTimeline.tsx:50-54` vs `app/src/views/deploy/BuildTimeline.tsx` |
| 1.3 | GA4 users, sessions, conversions | GA4 connects and counts properties only; no data call exists | `server/google.ts:104-109`, `constants.ts:110` |
| 1.4 | Search Console per site | Real, but site totals only: the query sends no dimensions, so no per-page or per-query data | `server/google.ts:126-133` |
| 1.5 | Keyword volume and difficulty | Always "n/a", even with DataForSEO connected. The form still offers the goal "Refresh search volumes" | `server/engine.ts:163`, `liveApply.ts:50`, `app/src/views/research/KwRequestSheet.tsx:8` |
| 1.6 | Research tab (competitor/SERP findings) | Empty; no Research agent job exists | `constants.ts:99`, `server/steps.ts:4` |
| 1.7 | Site architecture: silo tree, pillar pages, click depth | Empty forever. A new site gets `silos: []` and there is no UI or agent to set them | `app/src/store/slices/sites.ts:155`, `app/src/views/research/SiloTreeSection.tsx:33` |
| 1.8 | Internal link graph and audit | Empty (depends on silos). The demo graph is seeded random, not real links | `app/src/views/research/graph.ts:61-75` |
| 1.9 | SEO/GEO on-page audit | Empty; no job | `constants.ts:103` |
| 1.10 | AI Overview tracking | Empty; no source | `constants.ts:104` |
| 1.11 | CTA router with click rates | Empty; the built site has no call-to-action component | `constants.ts:105` |
| 1.12 | Experiments (A/B on titles, meta) | Empty; no table, no job | `constants.ts:108`, `app/src/views/Experiments.tsx` |
| 1.13 | Themes per site | Empty table, although a real theme exists per site in `site_identity` | `constants.ts:107`, `server/builds.ts:136` |
| 1.14 | Workflows "Running now" with "New site" and "Weekly content" | `runs` is never populated. "Advance" only increments a local counter | `app/src/views/Workflows.tsx:34-45`, `sites.ts:186-194` |
| 1.15 | Schedules (Weekly content, hourly access check, link audit) | Saved, but no server module reads them. "Run now" only writes an audit line | `sites.ts:196-199`; server audit of `server/workspace.ts:28` |
| 1.16 | Spend against budget, tokens per site and per agent | Always "No agent spend today", though the server records cost per job. `spend` and `tok28` are never fed. The budget alert links to this empty screen | `serverFacts.ts:27-36`, `app/src/views/Analytics.tsx:100`, `server/notify.ts:165` |
| 1.17 | Rich article checks (duplication, facts, fake-testing claim, links, sensitive topic) | Six presence checks only: sources, title, meta, keyword in title, notes, language review | `seed.ts:126-143` vs `server/checks.ts:13-26` |
| 1.18 | Approval queue for "Publish" gates, Orchestrator building job queues | Only build approval is real. Orchestrator, Research, Architect, SEO/GEO, Internal Linker, Analyst and Graphic Designer never run | `seed.ts:109-119`, `app/PORTING.md` §17 |
| 1.19 | In-app alerts for blocked domain, budget, quota | In-app list is derived only from requests, articles and builds. The "In-app" column for blocked and budget does nothing | `app/src/store/liveNotifs.ts` |
| 1.20 | Site moves from DNS to build to live by itself | Status is picked by hand in the Add site form. A successful deploy does not set "live", and the 6-hour access recheck depends on that status | `app/src/views/sites/AddSiteSheet.tsx:49-51`, `server/probe.ts:195-219` |

## 2. What a professional product has that Meridian lacks

Effort: S = up to 2 days, M = about a week, L = 2 weeks or more.

| # | Gap | Why the boss cares | What to build | Effort | Needs |
|---|---|---|---|---|---|
| 2.1 | Human article editor | Today a typo costs a full agent revision of up to 15 minutes (`server/article-api.ts:14` has no edit action) | `PATCH /api/articles/:id/content` for title, meta, slug and blocks; recompute checks; record an "edited" event. Editable fields in `app/src/views/content/LiveArticleDetail.tsx` | M | none |
| 2.2 | Article lifecycle after approval | `approved` and `rejected` are final. No unpublish, refresh, delete, or "published" state | Add `published_at` and `live_build_id`; actions `unapprove`, `refresh` (re-queues the writer with the old content and GSC data), `archive` | M | none |
| 2.3 | Bulk generation | One click per keyword today | `POST /api/articles/bulk { rid, keywords[] }`; checkboxes in the keyword result sheet; bulk approve in Review | S | none |
| 2.4 | Content calendar | No planned date anywhere | `planned_for` on articles; a month view; the scheduler queues due items | M | 3.1 |
| 2.5 | Real internal linking | The writer prompt never sees the site's other articles (`server/writer.ts:21`), and the build only adds a "latest 3" band (`server/sitebuild.ts:627-633`) | Pass existing titles and slugs to the writer; allow inline links in blocks; an Internal Linker job proposes links for approval; the graph draws from real data | M–L | none |
| 2.6 | Categories and silos in the built site | The `cluster` from keyword research is never used by the build | Category pages, three-level breadcrumbs, a silo editor on Site architecture | M | none |
| 2.7 | Custom domain and HTTPS automation | Deploy goes to `*.pages.dev`, but canonical and sitemap use the real domain, so the site is wrong until someone attaches the domain by hand (`server/cfpages.ts` has no domains call) | After the first deploy, call the Pages domains API, create the CNAME when the zone is in the account, poll certificate status, show a "Domain" step on Deploy | M | Cloudflare token with Pages Edit and DNS Edit |
| 2.8 | GSC per page and per query | Needed for rank tracking, refresh decisions and per-article results | Query with `page` and `query` dimensions; store daily rows in a new `gsc_rows` table; `GET /api/metrics/site/:id` | M | Google OAuth client |
| 2.9 | Rank tracking by keyword | The Rank screen is a headline feature and is empty | From 2.8: position and 7-day change per target keyword; fill the Rank table and heat map; deploy rank effect comes free | S after 2.8 | same |
| 2.10 | GA4 data | Integration card promises users and sessions | `runReport` per property, map property to site, fill the GA4 tab | S–M | GA4 property |
| 2.11 | Keyword volumes | Prioritising without volume is guesswork | Server calls DataForSEO search volume after the agent proposes keywords (one request per 1,000 keywords per the skill); store volume and competition | S–M | DataForSEO balance |
| 2.12 | Budget that enforces | `settings.budget` only raises an alert at 80% (`server/notify.ts:159-166`). Revisions overwrite earlier cost, and failed jobs record none | A `job_costs` ledger; refuse or hold jobs at 100% with a clear message; monthly cap; feed the Analytics screen | M | none |
| 2.13 | LAN and team access | Bound to `127.0.0.1` (`server/main.ts:33`), Host allow-list (`server/http.ts:34`), invite links and OAuth redirect hard-coded to localhost. Reviewers in other countries cannot reach it at all | `MERIDIAN_HOST` and `MERIDIAN_PUBLIC_URL`; configurable Host allow-list; `Secure` cookie under HTTPS; documented reverse proxy or tunnel. Also needs the API engine, since the README says the Claude subscription is for personal use | M (L with engine) | TLS proxy or tunnel; Anthropic API key |
| 2.14 | Password reset by email | Owner lockout has no recovery (README says so) though SMTP now works | Reset token flow reusing the invite mechanism | S | SMTP |
| 2.15 | Backup, export, import | The only export is the build ZIP. `data/secret.key` must travel with the database | `POST /api/backup` using SQLite `VACUUM INTO` plus media and key warning; nightly backup with retention; restore documented | S–M | none |
| 2.16 | Audit log quality | Screen shows 80 rows, API 200, no filter or export. Reset workspace deletes it (`server/workspace.ts:104`). Editors can post free-text entries (`server/workspace-api.ts:61-76`) | Pagination, filters, CSV export; keep audit on reset; mark client-written entries | S | none |
| 2.17 | API keys and outgoing webhooks | No way to integrate with other tools | Hashed bearer tokens with role; webhooks for article-ready, build-ready, deploy-live | M | none |
| 2.18 | Job control | Strictly serial queue, no cancel, no priority, no automatic retry (`server/jobs.ts`) | `POST /api/jobs/:kind/:id/cancel`; a queue panel in Workspace; one retry with backoff; deploys and builds on a separate lane from model jobs | M | none |
| 2.19 | Multi-language per site | One language per site, no hreflang (`server/sitebuild.ts:93-100`) | Language variants per article and `/xx/` paths. Low priority given the one-site-per-country model | L | none |
| 2.20 | Onboarding checklist and in-app help | First run is 18 empty screens. No help links exist in `app/src/shell/` | A checklist card on Workspace computed from existing state (engine, site, verify, research, article, build, Cloudflare, GSC, SMTP); a "?" link per screen | S | none |
| 2.21 | Global search and shortcuts | Search covers screens, sites, agents and English article titles only, substring, 8 results. Only Ctrl+K exists (`app/src/shell/SearchDialog.tsx:12-38`, `app/src/shell/Shell.tsx:32`) | Add keywords, native titles, builds, people; review shortcuts (J/K, A, R) | S | none |
| 2.22 | Data retention | Builds keep 10 versions, alerts 90 days, access checks 50 per site; nothing for articles, media or job steps | A retention section in Settings plus cleanup of rejected-article media | S | none |
| 2.23 | Stronger automatic checks | Review rests entirely on the human | Server-side: title and meta length, duplicate title or slug within a site, similarity against the site's other articles, source links still resolve, banned phrases such as "we tested" | M | none |

## 3. Workflow and automation gaps

- **No server-side workflow engine.** The scheduler runs only access rechecks, the report, GSC refresh and alert flushing. It never queues an agent job. "Weekly content", "New site" and "Internal link audit" are labels.
- **Build:** a `workflow_runs` table and a small state machine (`server/workflows.ts`) that reads the `schedules` document. Weekly content = keyword research → pick top N unwritten keywords → queue articles → stop at review → after approvals queue a build → stop at build approval → deploy. Effort L. Do this as fixed code paths, which is what `skills/agent-orchestration/SKILL.md` §1 recommends for well-defined tasks; an LLM Orchestrator is not needed yet.
- **Seven of eleven agents never run:** Orchestrator, Research, Architect, SEO/GEO Optimizer, Internal Linker, Analyst, Graphic Designer. Their skills exist in `skills/`. Either hide them behind a "Planned" badge (S) or implement in this order: Analyst (after 2.8), Internal Linker (2.5), Architect (2.6), SEO/GEO as a post-build audit of the generated HTML, Research (needs DataForSEO SERP).
- **Agent configuration is mostly cosmetic.** Only the model choice reaches a job (`server/engine.ts:93-95`). Skills are hard-coded in prompts (`server/writer.ts:43-44`); pause, workers and added skills change nothing.
- **Placebo settings:** `parallel`, `apPublish` and `native` are not read by the server. Approval is refused only on a `bad` check, and a missing language review is a `warn` (`server/articles.ts:91-94`), so "Require native-speaker review" is enforced in the browser only. Per-site review modes (`app/src/views/content/ReviewModes.tsx:32`) are stored and ignored, and their note says some articles "publish without a person reading them", which contradicts the product's core promise.
- **Chain breaks needing manual clicks:** approval does not offer a build; deploy does not mark the site live or publish dates; a new site has no guided path through verify, research and first build.
- **Input validation:** `POST /api/articles` and `POST /api/requests` trust the client's site id and domain.

## 4. Quick wins vs big bets

**Quick wins (S):**
- Feed real spend and tokens into Analytics (1.16).
- Disable or label every control that does nothing: schedules, Run now, parallel, apPublish, review modes, pause, and the "Refresh search volumes" goal.
- Enforce native review on the server.
- Fix false empty-state promises on Rank and GA4.
- Audit export, and keep audit on reset.
- Set site status from deploys.
- Onboarding checklist.
- Password reset.
- Bulk write and bulk approve.
- Show the real theme in the Themes table.
- Backup button.

**Medium:** article editor, GSC per page and query with rank tracking, DataForSEO volumes, custom domain automation, budget enforcement, job cancel, stronger checks, categories.

**Big bets (L):** workflow engine with Weekly content, team access with the API engine, internal link engine, experiments, AI Overview tracking, multi-language.

## Recommended roadmap, next iteration

1. **Honesty pass** (S): disable or badge non-functional controls, fix false promises, enforce native review server-side.
2. **Spend ledger and enforced budget** (M): makes Analytics real and lets the boss run automation safely.
3. **Article editor, unapprove and refresh** (M): removes the biggest daily friction in review.
4. **Custom domain and HTTPS on Cloudflare, site status from deploys** (M): without it a "deployed" site is not actually live on its domain. Test against a real Cloudflare account first; the README says it has only been tested against a fake.
5. **GSC per page and query, then rank tracking and deploy rank effect** (M): fills the Rank screen, per-article results and the timeline in one go.
6. **DataForSEO volumes in keyword research** (S–M): turns keyword lists into prioritised lists.
7. **Bulk write, bulk approve and a queue panel with cancel** (S–M).
8. **Weekly content workflow engine with real schedules** (L): depends on 2, 6 and 7.
9. **Real internal links and categories in the build** (M–L): makes Architecture and Links screens real.
10. **Backup, audit export, password reset and the onboarding checklist** (S each): operational safety before more people depend on it.

Team and LAN access is deliberately left for the iteration after: it needs the Anthropic API engine and HTTPS, and the memory notes say there is no API subscription yet.