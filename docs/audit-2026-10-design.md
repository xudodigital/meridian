# Meridian dashboard design review

## Coverage: the review is incomplete
The session on tab-4 expired mid-review and the app dropped to Sign in. I stopped there and did not sign in, as instructed. The last authenticated request and the next one are far apart in the network log, so the idle sign-out is the likely cause.

- **Seen live (1440x900, light):** Workspace (cards and Office toggle), Article review (Waiting, and the Decided article detail to the bottom), Sites (List, Map, Themes), Workflows, Run history, Build and deploy, Research and SEO (all 5 tabs and the New research request dialog).
- **Seen live, signed out:** Sign in at desktop light, desktop dark and mobile light.
- **Not seen live:** Architecture, Internal links, Experiments, Rank, Analytics, Reports, Models and skills, Team, Integrations, Audit log, Settings, standalone `/office`, and every signed-in screen in dark or at mobile width. Findings for these are from source only and are marked **[code]**.
- The viewport on tab-4 is reset to desktop. Its colour-scheme emulation is still set to light, which the reset does not clear. Nothing in the repo was edited and no state-changing action was clicked.

To finish the dark and mobile pass, someone needs to sign in on tab-4 again and re-run me.

## Top 5 changes for perceived professionalism
1. **Remove the 8px body margin** (A1). The app floats in an 8px frame and the whole page scrolls 8px.
2. **Calm the agent grid** (B1). Eleven different pastel card colours, including a saturated lime, read as a toy; use neutral cards with the agent colour on the avatar only.
3. **Design empty states and first-run guidance once** (C1–C3). Most screens are a dashed box with one passive sentence and no action; give each an icon, a short title and a call to action, plus a setup checklist on Workspace.
4. **Cut the navigation from 18 to about 11 entries** (D1) and remove duplicated content between Sites, Workflows and Build and deploy.
5. **Fix table craft** (B3–B6): wrapped headers, time-only timestamps, the "Asked by" run-on text, row actions with a red Remove in every row, and "—" or "n/a" filler.

## A. Defects

| # | Where | What I saw | Change | Effort | Impact |
|---|---|---|---|---|---|
| A1 | `app/src/styles/compat.css` (`body{margin:8px}`) | Measured: `#app` starts at x=8 and is 1424px wide in a 1440 viewport; the document is 908px tall in a 900px window and scrolled 8px, shifting the sidebar. The file comment says it was kept only to match the prototype. | Delete the rule. | S | H |
| A2 | Sites: tiles vs Map | The tile says "0 Blocked in their country" while the Map panel says "Has blocked domains", "Blocked in Indonesia 1" and "1 site · 1 blocked". The site is unreachable because DNS is not pointed, not because it is blocked. | Use one definition. Separate "Not reachable (DNS not set up)" from "Blocked by ISP", and make the tile, map, filter and pill agree. | M | H |
| A3 | Sites: status vocabulary | The pill says "Being set up"; the filter offers "Live / Building / Waiting for DNS / Paused / Blocked by ISP"; the tile says "Blocked in their country". | One status list, used verbatim in pill, filter, tile and map legend. | S | M |
| A4 | Sites > Themes (`MOD_EMPTY.themes`) | "No themes yet. A theme is listed here once a site has been built", while the site has three builds (v3 approved). | Derive the theme from the build, or change the copy to say what actually triggers it. | S–M | M |
| A5 | Office view, Break room | Names that wrap to two lines (SEO/GEO Optimizer, Deploy & Monitor, Graphic Designer) push their Idle pill and the "—" line lower than their neighbours. | Reserve two lines for the name, or truncate with a tooltip. | S | M |
| A6 | Session expiry (`shell/Login.tsx`) | After expiry the screen is a plain Sign in with no explanation; the URL `/architecture` was kept. | Show "You were signed out after inactivity. Sign in to continue where you left off." | S | M |
| A7 | Workflows > Schedules note | Says "Monday 06:00 for a Vietnamese site" when the only site is Indonesian. | Use the first real site's country, or drop the example. | S | L |
| A8 | Research > Keywords callout | "through Claude Code 2.1.284 (Claude Code) on this computer" repeats the name. | "through Claude Code 2.1.284 on this computer". | S | L |
| A9 | Build and deploy > Deploy timeline | The empty state is followed by an orphan note, "Oldest on the left." | Hide the note when the timeline is empty. | S | L |
| A10 | Settings **[code]** `views/Settings.tsx` | The inactivity options include "1 minute (to try it now)" in the real settings. | Show it only in demo mode. | S | M |
| A11 | Team **[code]** `views/Team.tsx` | The loading state is the dashed empty box with "Loading the team…". I found no skeleton or spinner pattern in `src`. | Add a skeleton-row state to `Table` and use it wherever data is fetched. | M | M |

## B. Visual hierarchy, density and consistency

| # | Where | What I saw | Change | Effort | Impact |
|---|---|---|---|---|---|
| B1 | Workspace agent cards (`.desk`, `.h0`–`.h10` in `tokens.css`) | Every card has its own pastel fill (blue, violet, pink, peach, lime, mint, cyan and more); the lime `#acf847` container is far louder than the rest. | Neutral `surface-container-low` cards; keep the colour on the avatar, progress bar and a thin accent. Keep full tint for the working state only. | M | H |
| B2 | Workspace cards | With all agents idle, each card repeats "Waiting for a task", an empty progress bar, a "—" site tag, "0 tokens", a stepper, pause and delete. The delete icon sits on every card. | Collapse idle cards to header, model and workers; show the bar and tokens only when working; move delete into the agent sheet or an overflow menu. | M | H |
| B3 | Tables: Sites, Build and deploy, Research | Headers wrap to two or three lines ("Access from country", "Spend today", "Topic or seed keywords"). | Shorter labels ("Access", "Spend", "Topic") with `white-space:nowrap` on `th`; put the long form in a tooltip. | S | M |
| B4 | Run history, Workspace activity, Audit **[code: `hhmm`]** | Time only ("12:30"), no date. Other tables use "3 Oct, 12:31". | One relative or absolute date-time format everywhere. | S | M |
| B5 | Run history, Task column | "Building kopirobustalampung.example v3 Asked by Meridian Admin" runs together; the domain is repeated in the Site column. | Put "Asked by …" on a second muted line, and drop the domain from the task text. | S | M |
| B6 | Sites row actions; Team **[code]** | "Pause  Verify  Remove" as three text buttons, with a red Remove in every row. Team has up to four per row. | One primary inline action plus an overflow menu holding Remove. | M | M |
| B7 | Page headers | Primary button placement differs: Sites has it beside the lede; Research > Keywords has "New research request" alone on its own row; Workflows and four of the Research tabs have none. | A single page-header pattern: lede on the left, one primary action on the right. | M | M |
| B8 | Explanatory notes | Almost every section ends with a small grey paragraph (Workflows has three, Build and deploy has a four-sentence lede, Office has a five-line legend). | Keep one-line ledes; move the rest into an info tooltip or a "How this works" disclosure. Turn the Office legend into an icon key. | M | M |
| B9 | Sites tiles | Four large coloured tiles to say "1, 0, 1, 0". | A compact stat strip, or hide it below a handful of sites. Use one tile style across Sites, Run history, Analytics and Reports. | S | M |
| B10 | `shell.css` `.view` | No max-width, so tables and cards stretch on wide monitors; ledes are capped at 62ch, leaving a ragged right side. | Cap `.view` at roughly 1280–1360px. | S | M |
| B11 | Article review detail | The detail is a full bilingual article; the 340px list column is blank below its one item for the whole scroll, and "Review mode by site" (a setting) sits beneath it. | Make the list sticky; move Review mode into a tab or Settings; add a sticky header with the title and decision status. | M | H |
| B12 | Article review, empty | Two empty boxes side by side: dashed "No articles in this list." and filled "Pick an article from the list to read it." | When the list is empty, show one full-width empty state. | S | M |
| B13 | Build and deploy | Versions appear twice (the Website card lists v1–v3; Deploy history lists v2–v3 with "Not deployed" and "—"). Five stacked sections, two of them empty. | Merge Deploy history into the version list; hide the timeline and "Needs approval" until they have content. | M | M |
| B14 | Filler values | "—" under every Office agent, "—" in action cells, "n/a" in two whole columns of the keyword table. | Hide Volume and KD until a keyword data account is connected (the callout already explains it); omit empty lines. | S | M |
| B15 | Research > Keywords | The keyword table has no heading; a note above says keywords "are added to the table below". | Add a "Keywords (13)" heading with a search or cluster filter. | S | L |

## C. Empty states, onboarding and feedback

| # | Where | What I saw | Change | Effort | Impact |
|---|---|---|---|---|---|
| C1 | `components/Empty.tsx` and `.empty` | One dashed box, centred 14px grey text, no icon, title or action. It appeared about ten times across the screens I visited. | Extend `Empty` with `icon`, `title`, `body`, `action`. Example: Research tab gets "No research yet" and a "Run research for kopirobustalampung.example" button. | M | H |
| C2 | Research: Research, SEO/GEO, AI Overview, CTA router tabs | All four are empty and offer no way to start anything. | Add the triggering action to each, or hide tabs that cannot have data until a site is live. | M | H |
| C3 | Workspace hero | "Your agents are ready." with four zero KPIs, while the site is unverified, DNS is not pointed and Cloudflare is not connected (stated on Sites and Build and deploy). | Add a "Finish setup" checklist: verify ownership, point DNS, connect Cloudflare, connect Search Console, each linking to its screen. | M | H |
| C4 | Workflows | Read-only page; the Templates cards look clickable but are not. | Add "Run workflow" and "Add schedule", or present templates as plain reference text. | M | M |
| C5 | Sign in, dark | The primary button becomes pale lavender (`#bbc3ff`) and looks disabled next to the saturated hero. | Use a more saturated primary for filled buttons in dark (for example the `--hero-a` blue with white text). | S | M |
| C6 | Sign in, mobile | Works well; the footnote "Accounts are kept by the Meridian server on this computer." floats at the bottom with a large gap. | Place it under the help text. | S | L |
| C7 | Snackbar **[code]** `components/Snackbar.tsx` | Success and error use the same 4-second inverse snackbar, with no dismiss button or action. | Give errors a distinct style and keep them until dismissed. | S | M |

## D. Navigation and information architecture

**D1. Reduce 18 entries to about 11** (`store/constants.ts` `NAV`). Effort M, impact H.
- **Run history and Audit log:** both are chronological logs. Merge as "Activity" with Runs and Audit tabs.
- **Workflows and Build and deploy:** "Site builds" on Workflows repeats the Website section of Build and deploy. Merge into one "Build and deploy" with Builds, Schedules and Access tabs.
- **Domain access:** shown in Sites (column and map) and in Build and deploy (table). Keep the detail in one place.
- **Site architecture, Internal link engine, Experiments:** fold into Research and SEO as tabs, or into a per-site detail page. Experiments is a single table **[code]**.
- **Rank tracking and Analytics:** make Rank a tab of Analytics; both depend on Search Console **[code]**.
- **Reports:** keep, or make it an Analytics tab with the delivery settings.
- **Team, Integrations, Settings, Models and skills:** move under one Settings area with sub-navigation.

**D2. Sidebar at 900px height.** Only 13 of 18 items are visible without scrolling the nav. Items are 48px tall. Use 40px rows on desktop; D1 solves most of it. Effort S, impact M.

**D3. Naming.** "Research and SEO" contains a tab called "Research"; "Internal link engine" and "CTA router" are internal jargon. Rename to "Internal links" and "Calls to action". Effort S, impact L.

**D4. Global site picker.** "All sites" takes 280px in the top bar on every screen while there is one site. Hide or shrink it for a single site. Effort S, impact L.

## E. Accessibility

Good already: tabs and nav expose roles and `aria-current`, focus rings are restored after `all:unset`, and icon buttons have labels.

- **Placeholder contrast.** `::placeholder` is `on-surface-variant` at 0.7 opacity on white. By my calculation that is about 4.1:1, under the 4.5:1 target. Remove the opacity. Effort S, impact M.
- **Small text.** Table headers, tags, pills and nav group labels are 12px (`label-medium`). Raise table headers and group labels to 13px. Effort S, impact L.
- **Status by colour alone.** Every pill uses the same dot; only the colour differs ("Approved", "Rejected", "Down"). Add distinct icons for ok, warn and bad. Effort S, impact M.
- **Dark-mode contrast of the signed-in app:** not verified, see Coverage.

## Files most relevant to the changes
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/styles/compat.css` (A1)
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/styles/tokens.css` and `components.css` (B1, C5, placeholder contrast)
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/styles/shell.css` (B10, D2)
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/components/Empty.tsx`, `Table.tsx`, `Snackbar.tsx` (C1, A11, C7)
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/store/constants.ts` (`NAV`, `MOD_EMPTY`: D1, A4)
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Workspace.tsx`, `workspace/DeskCard.tsx`, `workspace/Office.tsx` (B1, B2, A5, C3)
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/views/Review.tsx`, `Sites.tsx`, `sites/SitesTable.tsx`, `sites/SitesMap.tsx`, `Deploy.tsx`, `Workflows.tsx`, `History.tsx`, `Settings.tsx`, `Team.tsx`
- `/Users/ranggaoctaviyanto/Documents/projects/meridian/app/src/shell/Login.tsx` (A6)