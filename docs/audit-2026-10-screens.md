I read all 18 routes, their subfolders, the store, the shell, and enough of `/Users/ranggaoctaviyanto/Documents/projects/meridian/server` (read only) to tell which settings actually change what jobs do. All paths below are absolute.

## Short answer

- **Really connected to the server:** Article review (real articles), keyword research requests and results, the Build and deploy website pipeline, domain access checks, ownership verify, Integrations, Team, sessions, Reports (data, send now and the schedule), the Search Console tab, Run history (from server jobs), the Audit log, and notifications.
- **Saved to the server but changes nothing:** schedules (cadence, on/off, "Run now"), agent pause/resume, workers count, the model choice for agents other than Content Writer, Keyword and Site Builder, skill assignment, added skills, review mode per site, the "publish approval" switch, parallel workers, and the budget (it only triggers alerts and a report label).
- **Always empty outside demo mode, because nothing ever fills them:** the module tables for research, architecture, content drafts, seo, aio, cta, themes, experiments, ga4 and rank; the silo tree; the link graph; the rank heat map; Workflows "Running now"; the deploy rank effect; agent tokens; site spend and 28-day tokens.

## Cross-cutting facts

- **Demo vs live gate.** `liveOn = live.on && !sample` (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/rules.ts:78`). Live mode is only tried on localhost or 127.0.0.1 (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/live.ts:33`).
- **The simulation invents work only in demo mode.** Outside it, the tick only does the idle sign-out and moves progress for agents the server is driving (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/sim.ts:53`).
- **Starting state outside demo mode.** Every module table starts with `rows: []`, and there are no sites, schedules, runs, deploys or notifications (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/empty.ts:29-43`).
- **What gets saved.** The documents `sites, agents, skills, settings, schedules, reviewModes, notifyPrefs` are saved to the server (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/workspace.ts:13`). Settings and alert preferences are admin-only (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/sync.ts`, ADMIN_DOCS).
- **What the server actually reads from those documents** (`/Users/ranggaoctaviyanto/Documents/projects/meridian/server/workspace.ts:137-158`):
  - the site list;
  - `settings.apDeploy` (builds.ts:365);
  - `settings.quiet`, `budget`, `repTo`, `repFreq`, `repOn` (notify.ts, report.ts);
  - the idle timeout (sessions.ts:37) and the 2-step requirement;
  - `notifyPrefs`;
  - from the agents document, only the Site Builder's model (builds.ts:212, photos.ts:83).
  - The Keyword and Content Writer models are sent by the client with each request or article (live.ts:139, slices/content.ts:212).
  - It never reads `schedules`, `reviewModes`, `apPublish`, `native`, `parallel`, `workers`, `skills`, or agent `off`.
- **The server runs one job at a time, oldest first** (`/Users/ranggaoctaviyanto/Documents/projects/meridian/server/jobs.ts:1`). The budget only raises an alert at 80% (notify.ts:163-165) and labels the report "Near daily budget" (report.ts:43-49). It never stops a job.
- **Module tables filled outside demo mode:**
  - `keywords`, from finished research requests, with Volume and KD hard-coded to `'n/a'` (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/liveApply.ts:50`);
  - `factory`, from website builds (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/serverFacts.ts:38`);
  - `gsc`, from Search Console metrics (serverFacts.ts:46).
  - Every other table shows its `MOD_EMPTY` text forever (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/constants.ts:98-112`, used at `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/components/ModTable.tsx:27`).
- **Tokens and spend are never updated in live mode.** Only `sim.ts:71-73` writes `agent.tokens` and `site.spend`, and nothing writes `tok28`. The server does track spend: the report shows it.
- **Placeholder.tsx is unused.** No route imports it (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Placeholder.tsx`). If it were used it would show "{Title} is being rebuilt. This screen is not ported yet."

## Per screen (route → file)

### 1. /workspace → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Workspace.tsx` (+ `views/workspace/*`)

- **What it shows:** a hero with KPIs, agent cards or an "office" view, the content pipeline, live activity (latest 14 audit entries), and a "Needs approval" column.
- **Real:**
  - agents driven by server jobs: Keyword, Content Writer, Site Builder, Deploy & Monitor (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/liveAgents.ts:71`);
  - the website-build approval line (Activity.tsx:41-46);
  - the agent sheet's prompt from `/api/agents/prompts`, for Keyword and Content Writer only (AgentSheet.tsx:68-76).
  - The other 7 agents show: "This agent has no job runner yet, so Meridian never sends it a prompt." (AgentSheet.tsx:104).
- **Saved but no effect on jobs:**
  - **Pause/Resume.** The client just stops showing the job (draft.ts:100-103); the server still runs it.
  - **Workers +/−.** Capped at 8 and by the client-side `parallel` setting (slices/workspace.ts:53-63).
  - **Pause all / Resume all.**
  - **Add agent.** Adds configuration only; the agent has no runner.
  - **Retry.** Purely local.
- **Demo-only:** the deploy approval queue (`approvals`; Activity.tsx:51-58) and the Tokens today KPI (always 0 in live).
- **Empty states:**
  - "Nothing is in the pipeline. Its stages fill in when agents start work for a site." (Pipeline.tsx:31)
  - "No activity yet." (Activity.tsx:16)
  - "Nothing needs approval." (Activity.tsx:48)
  - Hero, no sites: "Start with your first site." with the sub-line "…Add a domain, then send the Keyword agent a research request." (helpers.ts:54)
  - Missing-key callout: "…keys cannot be stored yet, so switch those agents to a Claude model…" (Workspace.tsx:32). This wording is stale: Integrations does store keys now.

### 2. /review → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Review.tsx` (+ `views/content/*`)

- **Real (server articles):** Approve, Request revision (note required), Reject, Mark language review done, Try again, Find photos / Remove photo, batch approve (slices/content.ts:133-241).
- **Approving does not publish.** The article goes into the next website build (ArticleReview.tsx:77-82).
- **Read-only fields:** checks, title tag, meta description, slug (LiveArticleBody.tsx:55), the bilingual article, sources, agent notes, history.
- **No editor.** A person cannot change the article text, title or meta before approving. The only input is the revision-note textarea (ArticleReview.tsx:59-61).
- **Native review is a client-side gate only.** The Approve button is disabled when `settings.native` is on (ArticleReview.tsx:54,73). The server only marks it as a `warn` check (server/checks.ts:25-26) and refuses approval only on `bad` checks (server/articles.ts:93).
- **Drafts tab:** demo-only, reads `mod.content`. In live mode it is always "No drafts yet. Articles are listed here while the Content Writer works on them.", even while real articles are being written.
- **"Review mode by site":** saved to the server but enforced only by the demo simulation (draft.ts:71-73); the server ignores `reviewModes`.
- **Empty states:**
  - "No articles to review yet. An article is listed here when the Content Writer finishes it, and nothing publishes before a person approves it." (Review.tsx:49)
  - "No articles in this list." (Review.tsx:65)
  - "Pick an article from the list to read it." (ArticleDetail.tsx:17)
  - "No sites yet. Add a domain in Sites, then choose here how its articles are reviewed." (ReviewModes.tsx:22)
  - "No photos yet. Find photos looks on Wikimedia Commons for openly licensed photos that fit this article." (ArticlePhotos.tsx:108)
  - "No sources were cited." (LiveArticleBody.tsx:67)

### 3. /sites → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Sites.tsx` (+ `views/sites/*`)

- **Add domain** (AddSiteSheet.tsx:45-53):
  - fields: Domain, Target country (13 fixed countries), Content language (prefilled from country), Site topic, and, outside demo mode only, Status ("Being set up" / "Already live");
  - no custom-domain, silos, theme, budget or edit-site fields;
  - in live mode it only records the domain in the sites document (slices/sites.ts:156-158); `silos: []` is never filled.
- **Row actions** (SitesTable.tsx:60-64):
  - Pause/Resume changes only the document status; the server never reads "paused";
  - **Verify** (ownership TXT record, real, `servicesApi.verify`);
  - Remove (document only).
  - "Verify DNS" is demo-only and simulated (slices/sites.ts:118-126).
- **Spend today:** always $0.00 in live mode.
- **Themes tab:** `mod.themes`, always "No themes yet. A theme is listed here once a site has been built." in live mode, even though the server has theme.ts.
- **Empty states:**
  - "There are no sites yet. Add your first domain to get started." (Sites.tsx:61)
  - "No sites match these filters." (SitesTable.tsx:15)
  - Map: "There are no sites yet. Add a domain and its country appears on the map." (SitesMap.tsx:20)

### 4. /workflows → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Workflows.tsx`

- **Templates** are two static cards with no actions (Workflows.tsx:25-26):
  - "New site" = Site profile → Research → Keywords → Architecture → Theme → Content → Review → Deploy → Monitor;
  - "Weekly content" = "Starts at Keywords and repeats every week…".
  - There is no "New workflow" or "New schedule" button anywhere.
- **Running now:** `runs` is only filled in demo mode (slices/sites.ts:157), so it is always empty in live mode. "Advance" only increments a local step and logs it (slices/sites.ts:186-194).
- **Site builds:** real (factory rows from server builds).
- **Schedules:**
  - empty in live mode, because the default is `[]` and nothing creates one;
  - cadence select and switch save to the schedules document, which the server never reads;
  - "Run now" only writes an audit line, `'Started "' + c.wf + '" now'` (slices/sites.ts:196-199). Nothing fires.
- **Empty states:**
  - "No workflows are running. One is listed here from its first step to its last while agents work through it." (Workflows.tsx:44)
  - "No schedules yet. A workflow that repeats for a site is listed here with its cadence." (Workflows.tsx:54)
  - "No site builds yet. A build is listed here when the Site Builder starts on a site." (MOD_EMPTY.factory)

### 5. /history → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/History.tsx`

- **Real:** the job log comes from server research requests, articles, photo jobs and builds (liveApply.ts:56-73, liveArticleApply.ts:59, liveAgents.ts:313-347), with real step times.
- **Limits:** 40 rows, no pager, filter or export.
- **Empty state:** "No runs yet. Every job an agent finishes is listed here with its cost and log." (History.tsx:31)

### 6. /deploy → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Deploy.tsx` (+ `views/deploy/*`, `views/sites/ApprovalQueue.tsx`, `views/sites/DeployTimeline.tsx`)

- **Live mode is real:**
  - Website section: Build website, Preview, Download ZIP, Approve, Reject (reason required), Deploy / Try deploy again, Open live site;
  - Needs approval (builds);
  - access checks on Globalping ("Check now");
  - build timeline;
  - build history with roll back / roll forward (BuildHistory.tsx:55-72).
- **No custom-domain UI.** The live link is the `deployUrl` (pages.dev; parts.tsx:97-99).
- **Rank effect is demo-only.** It uses the `rank` field on sample deploys (seed.ts, `RANK` map; RankPill DeployTimeline.tsx:50-54) and the note "The rank effect is the average position change 7 days after the deploy, from Search Console." (Deploy.tsx:28). The live timeline (BuildTimeline.tsx) has no rank column.
- **Empty states:**
  - "No sites yet. Add a domain in Sites; its website is built here from the articles you approve." (WebsiteSection.tsx:35)
  - "No website builds need approval. A build waits here once the Site Builder has finished it." (BuildQueue.tsx:22)
  - "No domains to check yet. Add a domain in Sites and it is listed here." (Deploy.tsx:94)
  - "No deploys yet. The timeline shows each site's versions once the first one goes live." (BuildTimeline.tsx:14)
  - "No approved builds yet. Every website build you approve is listed here, and you can roll back to one that went live." (BuildHistory.tsx:63)
  - No probe network: "The probe network is not working. Test it in Integrations." (slices/sites.ts:26)

### 7. /research → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Research.tsx`

- **Tabs:** Research, Keywords, SEO/GEO, AI Overview, CTA router.
- **Only Keywords is real:**
  - New research request → `/api/requests` (live.ts:135);
  - View result / View error, Run again, and "Write article" → Content Writer (KwRequests.tsx, KwResultSheet.tsx, WriteArticleSheet.tsx).
- **Volume and KD are "n/a"** (liveApply.ts:50). The callout says: "Search volume and difficulty stay \"n/a\" until a keyword data account is connected." (KwRequests.tsx:68). DataForSEO is only used for "Test connection" (server/connectors.ts:38); no job ever calls it for volumes.
- **Other callouts:**
  - "Research requests cannot run." with NO_SERVER (KwRequests.tsx:39)
  - "Claude Code is not signed in on this computer… Until then requests are refused, so nothing is made up." (KwRequests.tsx:75)
- **The other four tabs** are module tables with no actions and are always empty in live mode:
  - "No research yet. Findings are listed here once the Research agent has studied a site's search results."
  - "No keywords yet. Send a research request above; the keywords it proposes are listed here."
  - "No on-page checks yet. Results are listed here once the SEO/GEO Optimizer has audited a page."
  - "No queries tracked yet. They are listed here once a site has pages in search."
  - "No calls to action yet. They are listed here once a site has published pages."
  - With no sites: "Research is done for one site at a time, in its country and language. Add your first domain, then send a request here." (KwRequests.tsx:42)

### 8. /architecture → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Architecture.tsx`

- **Silo tree:** built from `site.silos` plus seeded random page counts (siloTree.ts:29-46); `silos` is only set by demo "Verify DNS".
- **Silos table:** `mod.architecture`.
- **No actions.**
- **Empty states:**
  - "No silos yet. The tree is drawn once the Architect has planned the silos and pillar pages of a site." / "There are no sites yet. Add a domain in Sites; its silo tree is drawn here once the Architect has planned it." (SiloTreeSection.tsx:33)
  - "No silos planned yet. They are listed here once the Architect has planned a site."

### 9. /links → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Links.tsx`

- **The "Internal links" graph is entirely invented**, even with silos: "article j" nodes, random edges, and 3 fixed "Orphan page" nodes from a seeded generator (graph.ts:57-80).
- **The "Agents" graph is real data:** agents, attached skills, and the site each agent is working on.
- **Empty states:**
  - "There are no sites yet. Add a domain in Sites; the graph is drawn once the site has pages."
  - "{domain} has no pages yet. The graph fills in once the \"New site\" workflow reaches Content." (graph.ts:60-61). That workflow never runs in live mode.

### 10. /experiments → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Experiments.tsx`

- **What it shows:** the lede and `mod.experiments` only.
- **No create, edit or stop actions.**
- **Empty state:** "No experiments yet. They are listed here once an agent proposes one for a live site."

### 11. /rank → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Rank.tsx`

- **Callout when not connected:** "{name} is not connected. Connect it in Integrations to see its data here." (ModPage.tsx:23)
- **Heat map is demo-only:** `if (!s.sample) return []` (heatData.ts:22).
- **The tracked-keywords table is never filled**, even with Search Console connected.
- **Empty states:**
  - "No rank data yet. The heat map is drawn from Search Console positions once it is connected and a live site has traffic." (RankHeat.tsx:14)
  - "No keywords are tracked yet. Positions are listed here once Search Console is connected and a site has traffic."

### 12. /analytics → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Analytics.tsx`

- **Overview:**
  - clicks are real (Search Console);
  - tokens, per-agent tokens and spend are always empty in live mode (no writers).
  - Empty states: "No clicks recorded yet. This chart is drawn from Search Console once it is connected and a site has traffic." (:45); "No tokens used yet. This chart shows each site's share once agents have worked for it." (:50); "No agent has used tokens today. Each agent's share is shown here once it has done some work." (:71); "No agent spend today. Each site's spend is measured here against its daily budget of ${budget}." (:104).
  - The note "When a site uses its whole budget, its agents stop…" (:130) is false outside demo mode.
- **Search Console tab:** real (the server fetches metrics every 6 hours; server/metrics.ts).
- **GA4 tab:** "Connect with Google" OAuth works, but the server never fetches GA4 data (no GA4 calls in metrics.ts or google.ts beyond the scope). The table always reads "No GA4 data yet. Connect Google Analytics 4 in Integrations to see users and sessions here.", even after connecting.

### 13. /reports → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Reports.tsx` → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/content/LiveReport.tsx`

- **Real:**
  - server report (`servicesApi.report`);
  - Copy as CSV, which is the only export;
  - Send now (needs SMTP);
  - Scheduled delivery: repOn, repTo, repFreq of "Every Monday 08:00" / "Every day 08:00" / "First day of the month", fired by server/report.ts:111-125.
- **Empty states:**
  - "No sites yet, so there is nothing to report. Add a domain in Sites." (LiveReport.tsx:69)
  - "Set up Email (SMTP) in Integrations to send reports."
  - Tile: "Organic clicks (connect Search Console)"

### 14. /skills → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Skills.tsx` (+ `system/SkillCards.tsx`, `SkillForm.tsx`, `ModelList.tsx`, `ProviderSheet.tsx`)

- **Add skill** saves only the name and description (slices/system.ts:141-146). The "Instructions" textarea is uncontrolled and thrown away (SkillForm.tsx:25). No SKILL.md is written, and skills cannot be edited or deleted.
- **Versions:** outside demo mode there is only "Current version" (system.ts:127). Restore just changes the `ver` label.
- **Assign agents:** saved to the agents document, but the server never reads it. The writer hard-codes its skills (server/writer.ts:42).
- **Model by agent / Switch provider:** saved. The effect:
  - only Site Builder (server-read), Keyword and Content Writer (client-sent) models matter;
  - local mode runs Claude only, and non-Claude models fall back to Sonnet (server/engine.ts:92-95).

### 15. /team → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Team.tsx`

- **Fully real in live mode:**
  - invite gives a one-time link valid 7 days, with no email sent;
  - change role or site, disable/enable, reset 2-step, remove, revoke.
- **Empty state:** "Loading the team…" (Team.tsx:67)
- **Static:** the role cards.

### 16. /integrations → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Integrations.tsx` (+ `system/IntCard.tsx`, `ServiceSheet.tsx`)

- **Real:** save (encrypted), test, remove, and Google OAuth for gsc and ga4.
- **Card groups:** AI providers / Data and checks / Alerts and reports.
- **Gaps:**
  - DataForSEO is test-only;
  - GA4 is connect-only;
  - OpenAI and Gemini keys can be stored, but jobs still run via Claude Code ("an agent set to an OpenAI or Gemini model runs on Claude Sonnet", Integrations.tsx:28).

### 17. /audit → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Audit.tsx`

- **Real:** server audit entries over the event stream; the client keeps 200 (sync.ts) and shows the latest 80.
- **Missing:** export, search, actor or date filters, and paging.
- **Empty state:** "Nothing is recorded yet. Everything you and the agents do is listed here." (Audit.tsx:19)

### 18. /settings → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Settings.tsx`

What each setting does on the server:

| Setting | Effect |
|---|---|
| Daily budget | Alert at 80% and a report label only. Jobs are never stopped. |
| Maximum parallel workers | Client-only cap on the worker steppers. The server runs one job at a time. |
| Require approval before content publishes (`apPublish`) | Demo simulation only. |
| Require approval before a deploy (`apDeploy`) | Enforced (server/builds.ts:365). |
| Native-speaker review | Client-side button gate only. |
| Alert table and quiet hours | Enforced (server/notify.ts:44-89). |
| Require 2-step and idle sign-out | Enforced (server/sessions.ts:37). |
| Demo mode | Browser-only toggle. |
| Reset workspace | Real (`/api/workspace/reset`). |

- **Empty states:**
  - "No alert was sent by email, Slack or Telegram yet." (RecentAlerts.tsx:16)
  - "Loading your sessions…" (SessionList.tsx:23)

### Extra route

`/office` → `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/workspace/OfficeDisplay.tsx` is a full-screen office view with no shell. `/invite/$token` is the invitation page.

## Shell

- **Global search** (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/shell/SearchDialog.tsx:12-31`):
  - covers module names, the 9 old section names, sites (domain, country, topic), agents and articles;
  - a native reviewer can only search their own articles;
  - it does not cover keywords, research requests, builds, people, the audit log or settings;
  - empty query shows the first 6 entries; at most 8 results; Enter opens the first;
  - no matches: "No matches. Try a site, agent or module name."
- **Keyboard shortcuts:** only Ctrl/Cmd+K for search and Escape to close the side nav (Shell.tsx:35-36), plus arrow keys inside the Select component. There is no shortcut list.
- **Help, docs, onboarding:** none. No help or docs links, and no onboarding checklist. The only guidance is the hero copy ("Add your first domain" button, Hero.tsx:20) and the in-screen callouts.
- **Notifications** (`/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/liveNotifs.ts`):
  - built from server state: research done or failed, article written / revised / failed, website build ready or failed, deploy failed;
  - newest 40;
  - an event older than 14 days counts as read; read state is stored on the server per person;
  - filtered by the "In-app" column of the alert table.
  - Not in the bell: blocked or down domains, budget alerts, report sent. Those go to email, Slack or Telegram only.
  - Empty: "You are all caught up." (Popover.tsx:33)