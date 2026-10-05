# Porting guide for screen builders

Meridian is being rewritten from the single-file prototype `archive/prototype/index.html` into this React app. The foundation is done: data, demo-mode simulation, live mode, accounts, the server-side workspace, shell, shared components and styles. Your job is to replace the placeholder views in `src/views/` with real screens.

Since phase A (accounts) the app is a real local product: people sign in with accounts kept by the server, every change to the workspace is saved on the server, and nothing outside demo mode is invented. Sections 14 and 15 describe how; read them before you add anything that changes data.

You need three things: this file, the prototype (`archive/prototype/index.html`, the complete functional and visual specification) and the code in `app/src`.

Line numbers below refer to `archive/prototype/index.html`.

## 1. Ground rules

1. **The prototype is the specification.** Same markup structure, same class names, same behaviour, same order of sections.
2. **Copy must match the prototype exactly.** Every label, lede, note, button text, aria-label, tooltip, placeholder, snackbar and audit-log sentence is copied character for character, including punctuation, plurals ("1 worker" / "2 workers") and the `·` and `—` characters. Do not rephrase, and do not add text.
3. **Do not edit shared files.** You own only:
   - your view files in `src/views/` (and, if a view gets large, a folder `src/views/<name>/` for its parts),
   - your one slice file in `src/store/slices/`,
   - tests next to those files (`*.test.ts` or `*.test.tsx`).

   Everything else is shared and off limits: `src/store/*.ts` (types, constants, seed, rules, draft, sim, store, live, storage), `src/store/slices/slice.ts`, other groups' slices, `src/components/`, `src/shell/`, `src/styles/`, `src/router.tsx`, `src/nav.ts`, `src/App.tsx`, `src/main.tsx`, the config files, `web/` and `server/`.
4. **Need a shared change?** Do not make it. Write it down in `app/NOTES-<group>.md` (`workspace`, `content`, `sites`, `research` or `system`): what you need, why, and the exact signature or CSS you propose. Work around it locally until the main engineer applies it.
5. No new dependencies. No UI library, no CSS-in-JS. (One justified exception: `qrcode-generator` 2.0.4, MIT, no dependencies, draws the QR code of the 2-step setup in `shell/Qr.tsx`.)
6. All user-facing text is English.

## 2. Project layout

```
app/
  index.html              document shell and font links
  vite.config.ts          Vite 8, React Compiler, Tailwind 4, /api proxy to 127.0.0.1:4310, vitest
  PORTING.md              this file
  src/
    main.tsx              mounts the app and starts the simulation interval (1800 ms)
    App.tsx               QueryClientProvider, sign-in check (auth.ts), live mode, startSync(), RouterProvider
    router.tsx            11 view routes, alias redirects (old modules and merged screens -> view + tab), /invite/$token, /office, role guard, sign-in / 2-step / loading gates
    nav.ts                go(view)
    shell/                Shell (with the demo-mode and save-error banners), SideNav, TopBar, Popover (notifications,
                          account menu), AccountSheets (password, 2-step), ChangeNameSheet, SearchDialog,
                          Login (first run, sign-in, server offline), Enroll (required 2-step setup, loading),
                          InviteAccept (/invite/<token>), TwoStepSetup, Qr
    components/           shared components, import from '@/components'
    views/                one file per view: <Name>.tsx   <- yours
    styles/               the prototype's CSS, ported verbatim, plus Tailwind theme
    store/
      types.ts            every entity and the AppState type
      constants.ts        fixed tables: NAV, ALIAS, PROV, RATE, ST, AST, SST, ACC, WF_STEPS, CADS, EVENTS, ...
      seed.ts             createSeed(): the sample data
      empty.ts            createEmpty(): the empty state (configuration only), built from the seed's configuration; defaultSettings()
      workspace.ts        the workspace documents: docOf(), applyDoc(), defaults, rebase() (pure)
      sync.ts             loads the workspace after sign-in and saves every change to the server (section 14)
      auth.ts             bootAuth() at page load, the session heartbeat, what happens when the session ends
      authApi.ts          account and team endpoints (sign-in, 2-step, sessions, invitations, people)
      rules.ts            pure helpers and rules (also re-exports constants.ts)
      draft.ts            mutators used inside set(): logMineTo, addLogTo, notifyTo, snackTo, nextUid, newId, purge, ...
      session.ts          the signed-in person: actor(), sessionOf(me), name, email and password checks
      sim.ts              simTick(): the simulation
      live.ts             live mode against the local server
      liveApply.ts        liveApply(): rebuilds what the store derives from the server's research requests and articles
      liveArticleApply.ts real articles from the server: mapping to Article, the Content Writer's live flag, job log
      liveNotifs.ts       the bell's notifications for server events, derived from server state, and their read keys
      serverApi.ts        HTTP calls to the server (apiGet, apiSend, ApiError, articleApi); no store access
      store.ts            useStore, core actions, AppStore type
      testing.ts          makeState(), makeEmptyState(), resetStore(), meFor() and sessionFor() for tests
      fakeApi.ts          a fake server (fetch stand-in with routes) for tests
      articleFixtures.ts  real articles as the server sends them, for tests
      slices/             workspace.ts content.ts sites.ts research.ts system.ts   <- one is yours
```

Path alias: `@/` is `src/`.

## 3. Commands

Node 24 and npm are in `<project root>/.tools/node/bin`, which is not on PATH:

```sh
export PATH="/Users/ranggaoctaviyanto/Documents/projects/meridian/.tools/node/bin:$PATH"
cd /Users/ranggaoctaviyanto/Documents/projects/meridian/app
npm run typecheck   # tsc, strict; must print nothing
npm test            # vitest run; unit tests plus a jsdom smoke test of the shell
npm run build       # typecheck, then vite build into app/dist
npm run dev         # Vite on http://localhost:5173, proxies /api (and the event stream) to the server on 4310
```

Before you hand in: `npm run typecheck`, `npm test` and `npm run build` all pass.

## 4. How the prototype maps to React

| Prototype | Here |
|---|---|
| closure variables (`sites`, `agents`, `settings`, `state.*`) | one zustand store: `useStore(s => s.sites)` |
| `render()` after every change | nothing: components re-render when the state they select changes |
| `data-act="x"` + the big click `switch` (lines 2055-2139) | an `onClick` that calls a store action |
| `document.addEventListener('change', ...)` (2177-2193) | `onChange` on the control, calling a store action |
| `document.addEventListener('submit', ...)` (2140-2176) | `<form onSubmit>` in your sheet |
| `go('sites')`, `data-view="sites"` | `go('sites')` from `@/nav` |
| `tick()` DOM patching (1853-1871) | nothing: the tick changes the store, React updates the screen |
| `esc(x)` | nothing: React escapes text |
| `$('#sheet').innerHTML = ...; showModal()` | `<Sheet open={...} onClose={...}>` |

### Reading state

```tsx
import { useStore, useStoreShallow } from '@/store/store';
import { inSite, siteById, costOf } from '@/store/rules';

const agents = useStore(s => s.agents);                 // re-renders when agents change
const budget = useStore(s => s.settings.budget);
const waiting = useStore(s => s.articles.filter(a => a.status === 'review').length);   // a number: fine
const [sites, siteFilter] = useStoreShallow(s => [s.sites, s.siteFilter] as const);    // several values
```

A selector must return a stable value. Returning a **new array or object** from a plain `useStore` selector (`s => s.sites.filter(...)`) makes React loop forever. Either select the raw array and filter in the component body, or use `useStoreShallow`.

Rules in `rules.ts` take the state as their first argument: `siteOpen(s, site)`, `keyOK(s, agent)`, `inSite(s, id)`, `totalWorkers(s)`. In a component pass an object with the fields the rule needs (`inSite({ siteFilter }, id)`), or the whole store from `useStore.getState()` inside an event handler.

State is immutable outside `set`: never write `agent.status = 'off'` in a component.

The React Compiler is on. Write plain components; do not add `useMemo`, `useCallback` or `React.memo` by habit, and do not mutate props or state during render.

### Changing state: actions

Every change goes through a store action. Core actions (already there, `src/store/store.ts`):

| Action | Use |
|---|---|
| `guard(kind?)` | role check; see section 8 |
| `logMine(act, site?)` | audit-log entry under the signed-in person's name, plus the snackbar |
| `addLog(who, act, site?)` | audit-log entry under an agent's name |
| `notify(kind, icon, title, body, view, event?)` | in-app notification |
| `snack(msg, icon?)` | snackbar |
| `markNotificationsRead()`, `readNotification(id)`, `openNotification(id)` | bell |
| `signIn(me)`, `setMe(me)`, `signOut(msg?, server?)`, `changeName(name)` | the person the server signed in, a newer answer about them, signing out of the page (and the server), Change name (async, on the server) |
| `setTheme`, `toggleTheme` | theme |
| `setSiteFilter(id)` | top-bar site filter; also resets pagination |
| `setPage(key, page)`, `resetPages()` | pagination |
| `openConfirm(key)`, `closeConfirm()`, `confirmOk()` | confirm dialog; see section 7 |
| `revokeKey(id)` | the prototype's `key-del` (also Disconnect for OAuth) |
| `decideApproval(id, ok)` | the prototype's `ap-yes` / `ap-no` (Workspace and Build and deploy) |
| `applyAlias(alias)` | used by the router |
| `mutate(recipe)` | escape hatch for a one-off change from a component |
| `tick()` | simulation step; never call it from a screen |
| `setSampleData(on)` | demo mode on (admins, Settings) or off (anyone, the banner) |

Everything else the prototype does in its click, change and submit handlers is yours to add in your slice.

## 5. Your slice

Each group owns one file in `src/store/slices/`. It declares two interfaces and one object:

```ts
// src/store/slices/sites.ts
import { logMineTo } from '../draft';
import { hhmm, siteById } from '../rules';
import type { Slice } from './slice';

export interface SitesState {
  smode: SitesMode;
  sq: string;
  /** Site ids with an access check in flight (the prototype's state.checking). */
  checking: string[];                       // 1. add state here
}
export interface SitesActions {
  setSmode: (m: SitesMode) => void;
  pauseSite: (id: string) => void;          // 2. add the action's type here
}

export const sitesSlice: Slice<SitesState, SitesActions> = {
  initial: { smode: 'list', sq: '', sst: '', sco: '', checking: [] },    // 3. initial value
  actions: (set, get) => ({
    setSmode: m => set(d => { d.smode = m; }),
    pauseSite: id => {                                                    // 4. implementation
      if (!get().guard()) return;
      set(d => {
        const s = siteById(d, id); if (!s) return;
        if (s.status === 'paused') s.status = s.prev || 'live'; else { s.prev = s.status; s.status = 'paused'; }
        logMineTo(d, (s.status === 'paused' ? 'Paused ' : 'Resumed ') + s.domain, s.id);
      });
    },
  }),
};
```

- `set(d => { ... })` gives you a draft of the **whole** store. Mutate it directly, exactly as the prototype mutates its variables (immer makes the update immutable). You can change any domain data (`d.sites`, `d.agents`, `d.settings`, ...) from your slice.
- `get()` returns the current store, including every action.
- The slice is already composed into the store; `store.ts` does not change when you add fields.
- Inside `set`, use the mutators from `src/store/draft.ts`, not the store actions: `logMineTo(d, ...)`, `addLogTo(d, ...)`, `notifyTo(d, ...)`, `snackTo(d, msg, icon)`, `nextUid(d)` (the prototype's `++uid`), `purge(arr, fn)`, `releaseOrphansTo(d)`, `logRunTo(d, agent, status)`.
- No Set or Map in state (use arrays and records). Dates are `Date` objects, as in the prototype.
- Field names are global across slices: keep the prototype's `state.*` names (`gmode`, `gsel`, `mapSel`, `provTo`, ...) and check the other slice files before inventing a name.
- Side effects (timers, clipboard, fetch, localStorage) go **outside** `set`, in the action body or the component.
- Do not put view-only state in the store when nobody else needs it: an open sheet or a form field is `useState` in the view.

State that already exists, because the shell or the router uses it:

| Slice | State | Actions |
|---|---|---|
| workspace | `wsMode` (saved as `das-ws`), `agentSheet` (agent whose detail sheet is open; search sets it) | `setWsMode`, `openAgent`, `closeAgent` |
| content | `rtab`, `rsel`, `rdetail`, `rmsg` | `setRtab`, `selectArticle` |
| sites | `smode`, `dtab` (tab of Build and deploy), `sq`, `sst`, `sco` | `setSmode`, `setDtab`, `setSitesFilter` |
| research | `rctab` | `setRctab` |
| system | `atab`, `actab` (tab of Activity) | `setAtab`, `setActab` |

The Workspace view must render the agent detail sheet for `agentSheet` (the global search opens it with `openAgent(id)`).

## 6. Shared components

Import from `@/components`. Each matches the prototype's markup and classes, so the ported CSS applies. Class names not covered by a component (`.sh`, `.row`, `.note`, `.lede`, `.grow`, `.tags`, `.who`, `.ava`, `.hero`, `.kpis`, `.queue`, `.q`, `.feed`, `.bars`, `.steps`, `.checks`, `.dsec`, `.toolbar`, ...) are written directly in JSX with `className`, exactly as in the prototype.

| Component | Props | Usage |
|---|---|---|
| `Icon` | `name`, `fill?`, `className?` | `<Icon name="rocket_launch" />` (the prototype's `ic()`; always `aria-hidden`) |
| `Button` | `variant?: 'outlined' \| 'filled' \| 'tonal' \| 'text' \| 'danger' \| 'onhero' \| 'ghost'`, `size?: 'sm' \| 'md' \| 'lg'`, `icon?`, button attributes | `<Button variant="filled" icon="add" onClick={open}>Add domain</Button>` |
| `IconButton` | `icon`, `label` (aria-label), `title?`, `tone?: 'tonal' \| 'err'`, button attributes | `<IconButton icon="pause" label={'Pause ' + a.name} title="Pause" onClick={...} />` |
| `LinkButton` | button attributes | `<LinkButton title="Open details" onClick={...}>{a.name}</LinkButton>` |
| `Pill` | `kind: 'ok' \| 'warn' \| 'bad' \| 'info' \| 'mut'`, `live?` | `<Pill kind="info" live>Running</Pill>` |
| `SiteChip` | `id: string  \|  null` | `<SiteChip id={r.site} />` (the prototype's `chip(id)`) |
| `Chip` | children | `<Chip>{hhmm(l.t)}</Chip>` (a bare `<span class="chip">`) |
| `Tag` | `icon?`, `className?` | `<Tag icon="memory">{a.model}</Tag>` inside `<div className="tags">` |
| `Tiles`, `Tile` | `tone: 'a' \| 'b' \| 'c' \| 'd'`, `value`, `label` | `<Tiles><Tile tone="a" value={all.length} label="Sites" /></Tiles>` |
| `Cards`, `Card` | `lift?`, `className?`, article attributes | `<Cards><Card className="int">...</Card></Cards>` |
| `Tabs` | `label?`, `value`, `onChange`, `items: {id, label, icon?}[]` | `<Tabs label="Analytics sections" value={atab} onChange={setAtab} items={ATABS.map(([id, label]) => ({ id, label }))} />` |
| `Table` | `cols: (string  \|  {label, head})[]`, `rows: ReactNode[][]`, `num?: number[]`, `empty?`, `rowKey?`, `tableClass?` | `<Table cols={['Time','Actor','Action','Site']} rows={rows} num={[0]} />` |
| `ModTable` | `id: ModId` | `<ModTable id="themes" />` (the prototype's `modTbl(id)`) |
| `ModCellView` | `cell: ModCell` | renders one cell of `store.mod` (text, pill, or both) |
| `usePaged`, `Pager` | `usePaged(key, rows, size = 10)`; `<Pager pkey paged />` | `const pg = usePaged('dep', rows); ... <Table rows={pg.rows} /><Pager pkey="dep" paged={pg} />` |
| `Fields`, `Field` | `label`, `wide?` | `<Fields><Field label="Role" wide><input type="text" required maxLength={60} /></Field></Fields>` |
| `SearchField` | `label` (aria), input attributes | `<SearchField label="Search sites" placeholder="Search by domain, country or topic" value={sq} onChange={...} />` |
| `Checkbox` | `label` (aria), input attributes | `<Checkbox label="An agent fails, by Email" checked={on} onChange={...} />` (the `.ck` in the Settings table) |
| `Select` | `value`, `onChange(value)`, `options: {value, label}[]`, `label` (accessible name), `id?`, `icon?`, `searchPlaceholder?`, `disabled?` | `<Select label="Status" value={sst} onChange={v => setSitesFilter({ sst: v })} options={[{ value: '', label: 'Any status' }, ...]} />` |
| `Switch` | `checked`, `onChange(checked)`, `label?` (aria), `id?`, `disabled?` | `<Switch checked={c.on} onChange={v => toggle(c.id, v)} label={'Enable ' + c.wf} />` |
| `SwitchRow` | `checked`, `onChange`, children | `<SwitchRow checked={settings.twofa} onChange={v => set('twofa', v)}>Require a 2-step verification code at sign-in</SwitchRow>` |
| `Callout` | `icon`, `warn?`, children (inside its `<p>`) | `<Callout icon="shield" warn><b>Do not paste a real key.</b> This prototype ...</Callout>` |
| `Empty` | children | `<Empty>No sites match these filters.</Empty>` |
| `Dialog` | `open`, `onClose`, `id?`, `className?`, `backdropClose?`, `labelledBy?`, `label?` | low level; you normally want `Sheet` |
| `Sheet`, `SheetActions` | `open`, `onClose`, `title?`, `description?`, `labelledBy?`, `className?` | see section 7 |
| `ConfirmDialog`, `Snackbar` | none | mounted once by the app; do not render them |
| `Meter`, `Ring` | `Ring: percent, label (aria), tone?: 'warn' \| 'bad', children?`; `Meter: className?` | `<div className="meters"><Meter className={'h' + a.hue}><Ring percent={p} label={...} /><h3>{a.name}</h3><p>...</p></Meter></div>` |
| `cx` | class names | `className={cx('card', lift && 'lift')}` |

Notes:

- **Never render a native `<select>`.** The prototype replaces every select with its custom dropdown; `Select` is that dropdown (search box above 8 options, keyboard support, works inside dialogs). Where the prototype has `aria-label="..."` on the select, pass it as `label`; inside a `<label class="f">` pass the field's text.
- `Field` renders `<label class="f">`; put exactly one control inside.
- Agent colours: add the class `h0`..`h10` (`'h' + agent.hue`) to the card, row or meter, as the prototype does.

## 7. Dialogs, sheets, confirm, snackbar, notifications, audit log

### Sheet (the prototype's `#sheet`: forms and details)

Open state lives in your view (`useState`), unless the shell opens it (only `agentSheet`).

```tsx
const [open, setOpen] = useState(false);
const [msg, setMsg] = useState('');
...
<Sheet open={open} onClose={() => setOpen(false)}>
  <form onSubmit={e => { e.preventDefault(); const err = addSite(values); if (err) setMsg(err); else setOpen(false); }}>
    <h2>Add a domain</h2>
    <p>After the domain is verified, the "New site" workflow runs with this profile.</p>
    <Fields>
      <Field label="Domain" wide><input type="text" required placeholder="domain-f.example" value={domain} onChange={...} /></Field>
      ...
    </Fields>
    <p className="err" hidden={!msg}>{msg}</p>
    <SheetActions>
      <Button variant="text" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="filled" type="submit">Add domain</Button>
    </SheetActions>
  </form>
</Sheet>
```

- Built on the native `<dialog>` with `showModal()`: focus trap, Escape and focus return come from the browser. A click on the backdrop closes it, as in the prototype.
- Children mount only while open, so a form starts empty each time.
- `SheetActions` is the prototype's `dialog .actions`: it sticks to the bottom while the content scrolls. Keep it last.
- `title` and `description` props render the `<h2>` and `<p>` for you and name the dialog. For a form, write them inside the `<form>` as above (the prototype wraps the heading in the form) or use the props; both look the same. If you render your own heading, give it an `id` and pass `labelledBy`.
- Form validation messages are the prototype's `fail(...)` strings (lines 2151-2173), shown in `<p className="err">`. Have the action return the message (or `null`) rather than reading the DOM.

### Confirm (the prototype's `openConfirm`, lines 1880-1891)

```tsx
<Button size="sm" variant="danger" onClick={() => openConfirm(`site:${s.id}`)}>Remove</Button>
```

All seven keys are implemented in the store, with the prototype's titles, texts, button labels and effects:

| Key | Asks | Does (prototype action) |
|---|---|---|
| `ag:<agent id>` | Remove this agent? | `ag-del` |
| `site:<site id>` | Remove this domain? | `site-del` (also removes its approvals, runs, schedules, deploys, articles) |
| `rb:<deploy id>` | Roll back / Roll forward to vN? | `dep-rb` |
| `key:<integration id>` | Revoke the ... key? | `key-del` |
| `all:pause` | Pause every agent? | `all-pause` |
| `user:<user id>` | Remove this person? | `user-del` |
| `art:<article id>` | Reject this article? | `rv-no` |

Integrations: the Revoke button calls `openConfirm('key:' + id)` only when the integration is an AI provider with agents on it (`n.ai && using`), otherwise `revokeKey(id)` directly, as in line 1645.

### Snackbar

`useStore.getState().snack('Report copied as CSV')` or, inside `set`, `snackTo(d, msg, icon)`. Default icon is `check_circle` (`lock` for messages starting with "View-only"). The prototype passes icons such as `'info'`, `'lock'`, `'search'`, `'refresh'`, `'swap_horiz'`: keep them.

### Audit log

For something the signed-in person did (the prototype's `addLog('Admin', ...)`): `logMineTo(d, act, site?)` inside `set`, or `logMine(act, site?)` outside. The entry is recorded under the person's name (`actor(state)` from `session.ts`) and the same sentence is shown in the snackbar, so add no separate snackbar. Never write a hard-coded `'Admin'`.

Outside demo mode the audit log lives on the server. An entry made with `logMineTo` carries a client id (`cid`); `sync.ts` sends it to `POST /api/audit`, the server records it under the **signed-in person from the session** (never a name from the page), and its copy (with the server's `id` and time) replaces the local one in every browser. Entries cannot be edited or deleted through the API.

Actions the **server** performs write their own audit entries: research requests and retries, articles and every decision on them, accounts, team changes, sign-in security, Reset workspace. For those, the page shows the snackbar only (`snackTo`), never `logMineTo`, or the entry would be there twice. No request body names who did something: the server takes the actor from the session.

For an agent (`a.name`, `'Orchestrator'`, `'Deploy & Monitor'`): `addLogTo(d, who, act, site?)` or `addLog(who, act, site?)`. It only writes the log.

### Notifications

`notifyTo(d, kind, icon, title, body, view, event?)` inside `set`, or `notify(...)`. `event` (`'approval' | 'error' | 'blocked' | 'budget' | 'review' | 'report'`) ties it to the Settings alert table: when the In-app channel for that event is off, nothing is added. The channel flags are `store.np` (the prototype's `NP`).

Notifications about server events (keyword research finished or failed, an article written, revised or failed) are not raised with `notifyTo`. `liveNotifsTo()` (`liveNotifs.ts`, called by `liveApply()`) derives them from the server's requests and article histories every time server state is applied, each with a stable `key` (kind, server id, event time), so a reload or another browser shows the same ones without duplicates. Which keys the person has read is `store.notifRead`, kept per person on the server (`sync.ts` sends new keys to `POST /api/notifications/read`; other browsers of the same person get them on the event stream). The bell holds the newest 40; events older than 14 days, and ones already answered (a decision after a written version, a retry after a failure), are shown as read. A click (`openNotification`) selects the article it is about in Article review.

## 8. Roles and the site filter

**Views.** The router enforces `canSee` (reviewer: Article review only; editor: everything except Team, Integrations, Settings; admin and viewer: everything). You do nothing for this.

**The server enforces the same rules** (`server/access.ts`): admin everything; editor everything except Team, Integrations, Settings and audit administration (Reset workspace); native reviewer only the language review and Request revision, on their own site, and they receive only that site's articles and requests; viewer read-only. A refusal is a 403 with the same sentence as the page's snackbar. The page's `guard()` stays, so people get the message without a round trip.

**Actions.** The prototype blocks every changing action for a viewer ("View-only role. Ask an admin to make changes.") and for a native reviewer ("Your role reviews articles only."), except a fixed read-only list (line 1995). Here:

- Every action that changes data starts with `if (!get().guard()) return;`. `guard()` shows the right snackbar and returns false.
- The two actions a reviewer may do, `rv-native` and `rv-rev`, use `get().guard('review')`.
- Read-only actions need no guard: tabs, pagination, view modes (`ws-mode`, `sites-mode`, `gmode`), map selection, the sites search and filters, opening details (`ag-info`, `run-log`, `kw-result`, `sk-hist`), `copy-csv`, the site filter.
- Opening a form sheet (`form`) is **not** read-only in the prototype: guard it (`if (!guard()) return;` before `setOpen(true)`). The same goes for `prov-open` (Switch provider), `sk-assign` (Assign agents) and `check` (Check now).
- Controls stay visible for every role, as in the prototype; they are refused on use. The exceptions are the places where the prototype itself hides things for a reviewer (`isRev()` in `vReview` and `rvDetail`). Use `isRev(session)` from rules.

**Site filter.** `store.siteFilter` is `'all'` or a site id (the prototype's `state.site`). Filter lists with `inSite(s, id)`; `artVisible(s, article)` combines "site still exists" and `inSite`. `ModTable`, `mapData` and `modView` already apply it. For a reviewer the filter is fixed to their site: `revSite(s)` (the site of their account, `session.site`; the sample's `REV_SITE` in demo mode).

## 9. Tables, tabs, pagination, pills, chips, icons

| Prototype helper | Here |
|---|---|
| `tbl(cols, rows, num)` | `<Table cols rows num />`. Same empty text, same `scroll` wrapper, `wide` added automatically at 7 or more columns, `data-label` on every cell (the phone and tablet card layout prints it), numeric columns get class `n`. |
| a table the prototype writes by hand (`sitesTable`, the Settings alert table, the `bi` article table) | write the same markup by hand (`<div className="scroll wide"><table>...`), including each `data-label`, or use `Table` with `tableClass="bi"` |
| `modTbl(id)` | `<ModTable id="content" />` |
| `vTable(id)` | lede from `store.mod[id].d`, then `<ModTable id />`, plus the extras in lines 1582-1590 |
| `tabsHTML(key, cur, list, label)` | `<Tabs label value onChange items />`; `RTABS` and `ATABS` are in constants |
| `paged(key, rows, size)` | `const pg = usePaged(key, rows, size)`; render `pg.rows`, then `<Pager pkey={key} paged={pg} />`. Keep the prototype's keys: `sites` (size 12), `modes`, `dep`, `rep`. |
| `state.pg.sites = 0` | `d.pg.sites = 0` in your action (`setSitesFilter` does it) |
| `state.pg = {}` | `d.pg = {}` (`setSiteFilter`, `setRctab`, `setAtab` do it) |
| `pill(kind, text, live)` | `<Pill kind live>text</Pill>`; label tables `ST`, `AST`, `SST`, `ACC`, `REQ_ST` are `[kind, text]` pairs in constants |
| `chip(id)` | `<SiteChip id={id} />` |
| `ic(name)` | `<Icon name="..." />` |
| `fmt`, `short`, `hhmm`, `fmtDur`, `initials`, `usd`, `ago` | same names in `@/store/rules` |
| `MOD.x.rows` cells with `P('ok','Done')` | data: `{ pill: 'ok', text: 'Done' }`; `cellText(cell)` gives the plain text (for example to parse "4 orphan pages") |

## 10. Simulation (demo mode), hand-offs and live mode

- The tick runs every 1800 ms from `main.tsx`. You never call it and never patch the DOM: select what you show from the store.
- **Hand-offs** (the flying page in the Office view, lines 1317-1323 and 1855-1861): `useStore(s => s.handoff)` is `{ seq, pairs: [{ from, to }] }`. `seq` increases whenever agents finished a job in a tick; `pairs` lists each finished agent and who receives the job (`to` is null when nobody does). Run your animation in an effect keyed on `seq`. `nextAgent(s, id)` is in rules.
- Position changes of stations (the 650 ms move animation) are yours: measure before and after in a layout effect.
- **Live mode** (`src/store/live.ts`) is already connected by `App` and starts after sign-in. `liveOn(s)` (rules) tells you whether the server's research and articles are in use: the server answered **and demo mode is off** (demo mode never reads or writes server data). `store.live.engine` is the engine status (`claude-code`, or `none` when Claude Code is not found or not signed in); `store.kwReqs` holds the requests (live ones carry `rid`, `engine`, `step`, `summary`, `keywords`, ...). Finished live requests already appear in `store.mod.keywords.rows`, the job log and the notifications. Each request carries who asked (`by`, from the server's `requestedBy`, which the server takes from the session).
  - **There is no simulation engine any more.** Without Claude Code the server refuses a request or an article at once with "Claude Code is not signed in on this computer. Run ./login.sh in the Meridian folder, then try again." (and a job already queued fails with that error). Show that message; never show placeholder output.
  - Every job's steps come with the time each began (`steps: { at, text }[]` on requests and articles). Run history shows those real times (`JobRun.stepAt`); only sample runs in demo mode spread their duration evenly.
  - `sendRequest({ siteId, topic, goal })`: POST to the server; the server writes the audit log, the page shows the snackbar; rejects with the server's message (show it in the form).
  - `retryRequest(rid)`: "Run again"; shows the snackbar itself.
  - `refreshEngine()`: "Check again"; shows the snackbar itself.
  - `useSendRequest()`, `useRetryRequest()`, `useRefreshEngine()` are the same as TanStack Query mutations, for pending state.
  - In demo mode a keyword request is simulated: push it to `d.kwReqs` (lines 2168-2170) and the tick gives it to the Keyword agent. Outside demo mode without the server it is refused (section 14).
- **Live articles.** The Content Writer writes real articles on the server (`server/articles.ts`, `server/writer.ts`). `store.live.arts` holds them by server id; `liveApply()` maps each to an `Article` with id `'a' + server id` and `live` set (`LiveArticle`: server state, site profile, step, pending revision note, content, history, error) and puts them on top of `store.articles`, next to sample articles. Statuses: `writing` (queued or being written), `revisi` (revision queued or being written), `review`, `approved` ("Approved, not published": publishing needs a deploy, which is not connected), `rejected`, `failed`. Checks come from the server (`server/checks.ts`), never from the model. The Content Writer agent is flagged `live` while a job runs; each finished or failed job is written to Run history once (with who asked for it) and announced ("Article ready for review", "A revised article is back in review", "Article failed", derived by `liveNotifs.ts`).
  - Ask for one: "Write article" on a keyword in the result sheet (`views/research/WriteArticleSheet.tsx`) calls `sendArticle({ rid, keyword })` (content slice). The site profile comes from the site, or from the request when the site is gone. Duplicates (same site and keyword queued, being written or waiting for review) are refused with `ARTICLE_QUEUED`, by the store and by the server.
  - Decide: the content slice actions `markLanguageReview`, `approveArticle`, `requestRevision`, `rejectArticle` (after `openConfirm('art:' + id)`), `approveReady` and `retryArticle` call the server for a real article (`articleApi` in `serverApi.ts`; the server records the session's person) and put its answer in the store with `liveArticleTo()`; a refusal is shown in `rmsg`. Sample articles keep the prototype's behaviour.
  - The detail pane of a real article is `views/content/LiveArticleDetail.tsx` (status and step while writing, error and "Try again" when failed, otherwise the full article: checks, language review, search appearance, the two-column text with headings marked, sources as links, the agent's notes, history and the decision box).

## 11. Styling

- The prototype's whole stylesheet is ported verbatim into `src/styles/` (same class names, same custom properties, both themes, breakpoints 600 / 840 / 1200 / 1400). **Use the prototype's classes**; you should need almost no new CSS.
- Some CSS depends on ids and attributes. Keep them: `#rvline`, `data-st` on `.desk` and `.stn`, `data-detail` on `.rv`, `data-s` / `data-n` / `data-k` on `.pst`, `data-run` on `.pipe`, `aria-pressed` on `.mk` and `.crow`, `aria-selected` on tabs, `aria-current="page"`, the `--p` variable on `.ring`, `--s` on `.mk`.
- Inline styles the prototype uses (`style="width:..%"`, `style="flex-wrap:nowrap;gap:4px"`) stay inline styles.
- Tailwind 4 utilities are available for new layout needs and resolve to the same tokens: colours (`bg-surface-container-low`, `text-on-surface-variant`, `text-primary`, `bg-agent-container`, ...), radius (`rounded-xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 20, `2xl` 28, `3xl` 32, `full`), fonts (`font-sans`, `font-brand`, `font-numeric`), shadows (`shadow-1`..`shadow-3`), breakpoints `sm:` 600, `md:` 840, `lg:` 1200, `xl:` 1400. Tailwind's default palette is removed. A utility beats a prototype class on the same element.
- Do not use the bare utilities `ring` and `grow` (they are prototype classes here); use `ring-1`, `flex-1`.
- If you truly need a new rule, put it in a CSS file next to your view (`src/views/Sites.css`, imported from `Sites.tsx`) and wrap it in `@layer proto { ... }` so it sits with the ported CSS and below utilities. Prefix new class names with your view (`sites-...`). Changes to existing shared classes go through your NOTES file.
- Theme: `data-theme="light|dark"` on `<html>`, or neither to follow the system (as in the prototype). Never hard-code colours; use the custom properties. For canvas drawing read them with `getComputedStyle(document.documentElement)` as the prototype does, and redraw when `store.theme` changes.

## 12. Conventions

- One view per file, named export, PascalCase: `src/views/Sites.tsx` exports `Sites`. The router already imports these names; do not rename or move them. A view returns a fragment whose top-level children are the prototype's top-level elements (`<p className="lede">`, `<section>`, `<div className="sh">`, ...): the shell wraps them in `<div class="view">` and animates each direct child.
- The page title (`<h1>`) and the document title come from the shell. Do not render them.
- Sub-components for one view go in `src/views/<name>/` (lower case folder), for example `src/views/workspace/DeskCard.tsx`.
- Types: no `any`. Entity types are in `@/store/types`. A new field on an entity is a shared change (NOTES file); most prototype fields are already there (`Site.mode`, `Site.prev`, `Agent.prev`, `Skill.hist`, `Skill.fresh`, `Article.wait`, ...).
- New ids: `nextUid(d)` inside `set`, with the prototype's prefixes (`'x' + id` agents, `'s' + id` sites, `'u' + id` users, `'k' + id` skills, `'d' + id` deploys).
- A site created in the UI must set `spend: 0, clicks: 0, tok28: 0` (the type requires them; the prototype left the last two undefined).
- Randomness and time in actions: `Math.random()` and `new Date()` as in the prototype. Keep pure logic in functions that take them as arguments if you want to unit test it.
- Accessibility attributes in the prototype are part of the specification: `aria-label`, `role`, `aria-selected`, `aria-pressed`, `aria-hidden`, `title`.
- Tests: `*.test.ts` next to the code, using `makeState()` from `@/store/testing` for a plain state object. See section 14 for the two data modes in tests.

## 13. View map

Group = the slice you own. "Handlers" lists where the prototype implements the view's actions: `act` = the click switch (2055-2139), `submit` = the form handler (2140-2176), `change` = the change handler (2177-2193).

| View (route) | File | Slice | Prototype functions (lines) | Handlers to port into the slice |
|---|---|---|---|---|
| Workspace (`/workspace`) | `Workspace.tsx` | workspace | `ST`…`rvLine` 1275-1291, `deskHTML` 1292-1304, rooms and `floorHTML` 1305-1316, `nextAgent`/`flyDoc` 1317-1323, pipeline `STAGES`…`pipeUpd` 1325-1343, `stationHTML` 1344-1367, `agentsHTML` 1368, `vWorkspace` 1369-1389, agent sheet `openAgent` 1927-1939, tick animations 1853-1871 | act `ag-w` 2106-2108, `ag-retry` 2109, `ag-pause` 2110, `all-resume` 2103, `ws-mode` 2125 (exists); form `agent` 1897-1898, submit 2155-2158. Approve/Reject: `decideApproval` (core). Remove, Pause all: `openConfirm` |
| Article review (`/review`) | `Review.tsx` | content | `AST`, `artReady` 1392-1393, `rvList` 1394-1398, `rvListHTML` 1399-1401, `rvDetail` 1402-1422, `vReview` 1423-1433 | list click 2062 (`selectArticle`), act `rv-tab` 2126 (`setRtab`), `rv-back` 2127, `rv-native` 2128, `rv-ok` 2129, `rv-rev` 2130-2131, `rv-batch` 2133; change `data-mode` 2187. Reject: `openConfirm('art:' + id)`. Drafts tab: `<ModTable id="content" />` |
| Sites (`/sites`) | `Sites.tsx` | sites | `SST`, `ACC` 1447-1448, `GEO`, `LAND`, `landDots` 1449-1470, `MK` 1471, `mapHTML` 1477-1488, `sitesFiltered` 1489-1492, `sitesTable` 1493-1501, `vSites` 1502-1512 (`mapData` is in rules) | act `site-verify` 2115, `site-pause` 2116, `map-sel` 2123, `map-list` 2124, `sites-mode` 2121 (exists); change `data-sf` 2181, input `sq` 2197 (`setSitesFilter`); form `site` 1899-1900, `sdCountry` change 2182, submit 2159-2164. Remove: `openConfirm('site:' + id)`. Themes tab: `<ModTable id="themes" />` |
| Build and deploy, Workflows tab (`/workflows` -> `/deploy`) | `Workflows.tsx` | sites | `vWorkflows` 1513-1521 (`WF_STEPS`, `CADS`, `NEXT` in constants) | act `wf-next` 2119, `sch-run` 2090; change `data-cad` 2191, `data-sch` 2192. Site builds: `<ModTable id="factory" />` |
| Activity, Runs tab (`/history` -> `/activity`) | `History.tsx` | content | `vHistory` 1674-1681, run sheet `openRun` 1967-1974 | none (read-only) |
| Build and deploy (`/deploy`; tabs Website and Workflows, `dtab`) | `Deploy.tsx` | sites | `vDeploy` 1522-1536, `timelineHTML` 1562-1566 | act `check` 2118 (1200 ms timer; `state.checking`). Approve/Reject: `decideApproval`. Roll back: `openConfirm('rb:' + id)` |
| Research and SEO (`/research`) | `Research.tsx` | research | render 1807 (tabs + `vTable(state.rctab)`), `vTable` 1582-1590, `REQ_ST`, `kwReqHTML` 1571-1581, result sheet `openKwResult` 2230-2237 | form `kwreq` 1903-1904, submit 2165-2170 (live: `sendRequest`); act `kw-retry` 2081 (`retryRequest`), `eng-refresh` 2082 (`refreshEngine`), tab 2122 (`setRctab`, exists) |
| Research and SEO, Architecture tab (`/architecture` -> `/research`) | `Architecture.tsx` | research | `vTable('architecture')` 1582-1590, `hashStr` (rules), `treeHTML` 1538-1550 | none |
| Research and SEO, Internal links tab (`/links` -> `/research`) | `Links.tsx` | research | `vLinks` 1704-1709, graph: `seeded` (rules), `buildGraph` 1714-1743, `GTYPE` 1744, `initGraph` 1745-1764, `step` 1765-1771, `kick` 1772, `draw` 1773-1785, `info` 1786-1791, `selectNode` 1792-1796 | act `gmode` 2120, tree click 2061; redraw on theme change 2207-2208 |
| Research and SEO, Experiments tab (`/experiments` -> `/research`) | `Experiments.tsx` | research | `vTable('experiments')` 1582-1590 | none |
| Analytics, Rank tab (`/rank` -> `/analytics`) | `Rank.tsx` | research | `vTable('rank')` 1582-1590, `KG`, `heatHTML` 1551-1561 (`mapData`, `seeded`, `hashStr` in rules) | none |
| Analytics (`/analytics`) | `Analytics.tsx` | system | `vAnalytics` 1591-1604; GSC and GA4 tabs are `vTable('gsc' / 'ga4')` 1582-1590 | tab 2122 (`setAtab`, exists) |
| Analytics, Reports tab (`/reports` -> `/analytics`) | `Reports.tsx` | content | `reportRows`, `reportCSV` 1682-1686, `vReports` 1687-1697, CSV sheet `showCSV` 1983-1986 | act `rep-send` 2091, `copy-csv` 2092; change `data-set` 2189 (`repOn`, `repTo`, `repFreq`) |
| Models and skills (`/skills`) | `Skills.tsx` | system | `vSkills` 1605-1614, provider sheet `openProv` 1617-1631, assign sheet `openAssign` 1632-1638, versions sheet `openSkillHist` 1975-1982 (`skillClash`, `provPlan` in rules) | act `prov-apply` 2087, `sk-restore` 2088; change `data-skill` 2186, `data-model` 2188; form `skill` 1905-1906, submit 2171 |
| Team and roles (`/team`) | `Team.tsx` | system | `vTeam` 1698-1703 | form `user` 1901-1902, submit 2151-2154. Remove: `openConfirm('user:' + id)` |
| Integrations (`/integrations`) | `Integrations.tsx` | system | `intCard` 1639-1648, `vIntegrations` 1649-1654 (`priceNote` in rules) | act `key-test` 2134, `oauth` 2136; form `keyrep` 1895-1896, submit 2172; inline key form submit 2173. Revoke: `revokeKey` or `openConfirm('key:' + id)` |
| Activity, Audit log tab (`/audit` -> `/activity`) | `Audit.tsx` | system | `vAudit` 1655-1658 | none |
| Settings (`/settings`) | `Settings.tsx` | system | `vSettings` 1659-1673 (`TLBL`, `EVENTS`, `CH` in constants; `NP` is `store.np`; `sessions` is `store.sessions`) | change `data-set` 2189, `data-np` 2190; act `sess-del` 2093 |

**Navigation: 11 views (October 2026, audit D1).** `NAV` in `constants.ts` has four groups: Work (Workspace, Article review), Sites (Sites, Build and deploy), Insights (Research and SEO, Analytics, Activity), System (Models and skills, Team and roles, Integrations, Settings). `ViewId` is those 11 ids; `activity` (`Activity.tsx`, tabs Runs and Audit log) is the only new one. Eight former screens are tabs now and their components are the tab bodies, unchanged: `Workflows` in Build and deploy; `Architecture`, `Links`, `Experiments` in Research and SEO; `Rank`, `Reports` in Analytics; `History`, `Audit` in Activity. Their old ids (`workflows`, `history`, `audit`, `architecture`, `links`, `experiments`, `rank`, `reports`, plus `website` for the first tab of Build and deploy) are entries of `ALIAS`: `go('rank')`, `/rank` and `/#rank` select the tab (`applyAlias` writes `dtab`, `actab`, `rctab` or `atab`) and open the view, and search lists them by name. Link to a tab with its alias, never by setting the tab and calling `go(view)`. A notification that belongs to a tab carries `to: <alias>` next to `view`. Roles: `canSee` for views as before; `canSeeTab(session, alias)` for a tab (the Audit log is never shown to a native reviewer) and `activityTabs(session)` for the tabs Activity shows; with one allowed tab it shows that log without the tab row. Tests: `src/navigation.test.tsx`.

Old module ids still work as routes and in search: `/keywords`, `/seo`, `/aio`, `/cta` (Research tabs), `/content` (Review, Drafts tab), `/factory` (Build and deploy, Workflows tab), `/gsc`, `/ga4` (Analytics tabs), `/themes` (Sites, Themes mode).

`/office` is the Workspace's office on a page of its own (`views/workspace/OfficeDisplay.tsx`), for a second tab or a wall display: no side navigation or top bar, the same sign-in gates, and a role that cannot see the Workspace goes to its home view. `?site=<id>` applies a site filter. Full screen (button or F), the idle header and cursor, and the Screen Wake Lock live in `views/workspace/fullscreen.ts`.

Settings shared by two groups: `data-set` (line 2189) is used by Settings (system) and Reports (content). Each group adds its own small action; both write `d.settings[key]` and log `'Updated settings'`.

## 14. Two data modes: the real workspace and demo mode

The prototype runs on invented data. The app does not: it shows only real things, kept by the server. The sample data is still there, behind a switch, for demonstrations. `store.sample` says which mode is on.

| | Normal (default) | Demo mode |
|---|---|---|
| Switch | off | Settings > Demo mode (admins). Remembered in this browser as `das-demo` = `1`. Anyone can turn it off from the banner |
| Store starts from | `createEmpty()`, then the workspace loaded from the server after sign-in (`sync.ts`) | `createSeed()`, every time |
| Tick (`sim.ts`) | idle sign-out, and progress for an agent flagged `live` (a real server job). Nothing else | the whole simulation, as in the prototype |
| Saved | every change, on the server | never; nothing is read from or written to the server |
| On screen | | the banner "Demo mode: example data, not saved" on every screen |

`setSampleData(on)` rebuilds the store with `resetTo(draft, sample)`. It keeps the session, the theme and the connection to the server, clears selections and pagination, and outside demo mode marks the workspace as not loaded, so `sync.ts` loads it again.

**The empty state** (`empty.ts`) has no sites, articles, approvals, runs, schedules, deploys, module-table rows, job log, audit log, notifications, team or sessions. It keeps configuration, taken from the seed so the two modes cannot drift: the 11 agents as roles (idle, 0 tokens, no site), the skills, the integrations list with nothing connected, default settings (`defaultSettings()`: 2-step verification not required, sign-out after 8 hours idle, no report recipients), alert preferences, and the columns and descriptions of the module tables. These are also the defaults each workspace document falls back to, and what Reset workspace returns to.

**The workspace on the server** (`workspace.ts`, `sync.ts`). Seven versioned JSON documents: `sites` (without review modes), `reviewModes`, `agents` (configuration only: id, name, role, model, skills, workers, hue, tasks, gate, prev, paused or not), `skills` (without version history), `settings`, `schedules`, `notifyPrefs`. The audit log and each person's read notifications are tables. `sync.ts` watches the store: when a field a document is made from changes (`DOC_SOURCES`), that document is saved 400 ms later with `PUT /api/workspace/docs/:id { version, data }`. A stale version gets 409 with the server's version; the local change is merged onto it (`rebase`: item by item for lists with ids, key by key for objects) and saved again. A failed save shows a non-blocking banner (`state.sync.error`) and is retried; a refusal for good (403, 400) puts the server's version back. Changes from other browsers arrive on the event stream (`workspace`, `audit`, `reads`, `reset`) and are applied, merged under any unsaved local change.

**Rules for anything you add or change:**

1. **Normal mode invents nothing.** No number, name or event that did not come from the person or the server. Anything the prototype fabricates (seeded random values, simulated results, sample names) is gated on `store.sample`.
2. **A feature that cannot work yet says why and what to do** in normal mode: Send now without Email (SMTP) (`NO_EMAIL`), Check now while the probe network fails its test (`NO_PROBE`), Connect with Google before Google sign-in is set up (`NO_GOOGLE`), alert channels that are not connected. No "simulated", "prototype" or "fake" text renders outside demo mode (`views/__tests__/empty.test.tsx` checks every view).
3. **Every list needs an empty state** that says what will fill it and what to do next. Use `Empty`, or the `empty` prop of `Table`. `ModTable` takes its text from `MOD_EMPTY` in constants. A chart or visual is not drawn from nothing: show `Empty` in its section instead.
4. **Demo mode keeps the prototype's behaviour and copy.** When the two modes differ, branch on `sample` and leave the prototype's text in the demo branch.
5. **New saved state** goes into a workspace document: add it to `docOf()` / `applyDoc()` (and `DOC_SOURCES`), to `DOC_IDS` here and in `server/workspace.ts` with a shape check in `docError()`, and to `workspace.test.ts`. Per-person conveniences (theme, workspace view mode) may stay in localStorage.
6. **New ids for saved things** use `newId(d, prefix)` (random outside demo mode, so two browsers never pick the same id).

**Claude through Claude Code.** `claudeViaCode(s)` is true when the page is served by the Meridian server (`live.on`) and its engine is `claude-code`. `provOK`, `keyOK`, `availModels` and `missingProv` then count Claude as connected, so they take `{ ints, live }`. The Claude card on Integrations says it is connected through Claude Code (with the CLI version); when it is not signed in it says to run `./login.sh`. OpenAI and Gemini need keys, which cannot be stored yet.

**Requests and articles for a site that is not in the store.** The server sends `domain` on every request and article. `liveApply()` copies it to the request, to its keyword rows, to its run and to the article (`live.domain`). `siteShown(s, siteId, domain)` lets such a thing through only under "All sites" (`artVisible` uses it for articles), and `<SiteChip id domain />` shows the domain instead of "Removed site". Removing a site removes its sample articles but not real ones, which stay on the server.

**Tests.** The tests written against the prototype run in demo mode and say so: `makeState()` builds a seeded state, `resetStore()` puts the real store in demo mode, and the app smoke test switches demo mode on before the store is imported. For normal mode use `makeEmptyState()` and `resetStore(false)`; sign a test person in with `signIn(meFor(role, name, email))`. Talk to a fake server with `FakeApi` (`store/fakeApi.ts`): `vi.stubGlobal('fetch', api.fetch)`, then assert on `api.calls`. `views/__tests__/empty.test.tsx` renders every view empty, and a new view or list should be added to its table.

## 15. Accounts and the server API

Sign-in is real and happens on the server (`server/auth-api.ts`). The page never sees the session token: it is a random 32-byte token in an HttpOnly, SameSite=Strict cookie, and the database keeps only its SHA-256. Writes also need the `x-meridian` header from this host (`serverApi.ts` adds it), so other websites cannot make them.

- **At page load** `bootAuth()` asks `GET /api/auth/status`: the person signed in (`signIn(me)`), or the first-run screen "Create the owner account" when no account exists, or the sign-in screen. Without a server the page says how to start it.
- **Sign-in**: email and password; when the person has 2-step verification on, the server answers with a ticket and the page asks for the 6-digit code (or a recovery code). Wrong email and wrong password get the same message; repeated failures lock the email or client out for a few minutes.
- **Required 2-step**: when Settings > "Require a 2-step verification code at sign-in" is on, a person without it gets `session.enroll` and the Enroll screen (QR code, setup key, code, ten recovery codes shown once) before anything else; the server refuses other routes until then (403 `code: "enroll"`).
- **Idle sign-out**: the server ends a session after the idle time in Settings; an active page sends `POST /api/auth/touch` every 20 s. Any 401 signs the page out with "Your session ended. Sign in again."
- **Invitations**: an admin invites by email, role and (for a reviewer) site; the page shows the one-time link `http://localhost:<port>/invite/<token>` with a Copy button, because Meridian sends no email. `/invite/<token>` (`shell/InviteAccept.tsx`) sets name and password and signs the person in.
- **Account menu**: name, email, role; Change name, Change password, 2-step verification, Sign out. Settings > Sign-in security lists the person's own sessions (`views/system/SessionList.tsx`).

Routes (all JSON; every write needs `x-meridian: 1` from this host; everything but the first group needs a session):

| Route | Who |
|---|---|
| `GET /api/health`, `GET /api/auth/status`, `POST /api/auth/setup` (first run only), `POST /api/auth/sign-in`, `POST /api/auth/sign-in/code`, `POST /api/auth/sign-out`, `GET /api/invites/:token`, `POST /api/invites/:token/accept`, `POST /api/auth/reset/request`, `GET/POST /api/auth/reset/:token` | anyone |
| `GET/PATCH /api/auth/me`, `POST /api/auth/touch`, `POST /api/auth/password`, `POST /api/auth/2fa/setup`, `/2fa/enable`, `/2fa/disable`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/sign-out-others` | the signed-in person (open while 2-step setup is required) |
| `GET /api/state`, `GET /api/events`, `GET /api/workspace`, `GET /api/agents/prompts`, `POST /api/notifications/read` | every role (a reviewer gets their own site only, no audit log) |
| `POST /api/requests`, `POST /api/requests/:id/retry`, `POST /api/articles`, `POST /api/articles/:id/approve`, `/reject`, `/retry`, `POST /api/engine/refresh`, `POST /api/audit`, `PUT /api/workspace/docs/{sites,agents,skills,schedules,reviewModes}` | admin, editor |
| `POST /api/articles/:id/language-review`, `/revise` | admin, editor, the reviewer of that site |
| `PUT /api/workspace/docs/{settings,notifyPrefs}`, `POST /api/workspace/reset`, `GET /api/users`, `POST /api/invites`, `DELETE /api/invites/:id`, `PATCH/DELETE /api/users/:id`, `POST /api/users/:id/reset-2fa` | admin |

## 16. Connected services

Everything here runs on the server (`server/integrations.ts`, `connectors.ts`, `probe.ts`, `verify.ts`, `notify.ts`, `report.ts`, `google.ts`, `metrics.ts`, routes in `ops-api.ts`). The page never holds a secret.

- **Storage.** `PUT /api/integrations/:id { values }` (admin) stores the secret fields sealed with AES-256-GCM (`vault.ts`, key in `data/secret.key` or `MERIDIAN_SECRET_KEY`) and the rest as plain config, then runs the real test at once. An empty field keeps what is stored. `POST /:id/test` tests again, `DELETE /:id` removes. 2-step secrets are sealed the same way.
- **What the page gets.** `GET /api/state` and `GET /api/integrations` carry `IntegrationWire`: connected, tail (last 4 characters or the account), status (`ok`, `warn`, `bad`, or empty when not tested), the test message, the form fields and help text, and the non-secret config for admins only. `serverFacts.ts` puts these into `ints`, each site's `access`, `checked` and `clicks`, and the Search Console table. Those site fields are not saved in the sites document (`docOf` strips them).
- **Events.** `integrations` (refetch), `access`, `access-running`, `verify`, `verify-list`, `metrics`, `report`, `google-result`.
- **Access checks.** `POST /api/sites/:id/check` answers 202; the result arrives as an `access` event. One check is an HTTPS request and a DNS lookup from up to three Globalping probes in the site's country, compared with public DNS and with a request from this computer. Live sites are checked every 6 hours. A new blocked or down result raises the `blocked` alert.
- **DNS verification.** `POST /api/sites/:id/verify` looks up TXT `_meridian.<domain>` for the value in `VerifyWire` (an HMAC of the site, so it never changes).
- **Alerts.** `notify.ts` stores each alert once by key, holds it during quiet hours, then sends it to the channels the alert table turns on. Email goes to admins and editors, and a review alert also goes to the site's native reviewer. `GET /api/alerts` (admin) lists what happened.
- **Report.** `GET /api/report` is the 7-day report; `POST /api/reports/send` emails it with a CSV to `settings.repTo`. When `repOn` is set, the server sends it at 08:00 local time on the chosen schedule.
- **Google.** `POST /api/oauth/google/start { kind }` returns the consent URL. Google returns to `GET /api/oauth/google/callback`, which is matched by `state`, because the SameSite=Strict cookie does not come back from Google. Tokens are sealed; Search Console figures are fetched on connect and every 6 hours.
- **Tests.** `server/ops.test.ts` runs against fake services (`server/fixtures/fake-services.ts`: HTTP, DNS and SMTP). Point any service elsewhere with `MERIDIAN_URL_<NAME>` (see `net.ts`).

## 17. Photos, website builds, deploys and the live Workspace

- **Photos** (`server/photos.ts`, `commons.ts`, `photos-api.ts`). A photo job is queued when the Content Writer finishes, or by "Find photos" (`POST /api/articles/:id/photos`). The Site Builder (CLI tasks `photo-queries`, `photo-choice`) picks from Wikimedia Commons candidates that pass the license filter and looks at small previews before it chooses. The server downloads 960/1280 px files to `DATA_DIR/media/articles/<id>/` and serves them at `/api/media/articles/<id>/<name>`. `ServerArticle.images` (PhotoWire[]) and `.photos` (PhotoJobWire) carry them. `DELETE /api/articles/:id/photos/:photoId` removes one.
- **Website builds** (`server/builds.ts`, `sitebuild.ts`, `theme.ts`, `png.ts`, `zip.ts`, `build-api.ts`). `POST /api/sites/:id/builds` queues a build of the site's approved articles. The first build asks the Site Builder for the site's identity (`site-identity`), stored in `site_identity`. Output goes to `DATA_DIR/sites/<id>/builds/<version>/` with page-relative links, so the same files work under `/api/preview/<site>/<version>/` and at the domain root. Builds arrive as `BuildWire` (GET /api/builds, /api/state `builds`, SSE `build`). Approve, reject (with a note), deploy and zip live under `/api/builds/:id/*`. The theme is Material 3 from the identity's source color (vendored `server/vendor/material-color-utilities`, Apache-2.0).
- **Deploys** (`server/cfpages.ts`, `blake3.ts`): Cloudflare Pages Direct Upload with wrangler's file hash. They run as a `deploy` job driven by Deploy & Monitor. The fake in `server/fixtures/fake-cloudflare.ts` rejects wrong hashes.
- **Live Workspace** (`app/src/store/liveAgents.ts`). Real jobs drive Keyword, Content Writer, Site Builder and Deploy & Monitor, each showing the server's current step. Progress is estimated from elapsed time. When a job ends, its agent shows "Done" or "Failed" for `DONE_MS`, and hand-off pages fly between agents for real transitions (`store.handoff`). A job that ends within `MIN_WORK_MS` of being shown is kept at its desk until then, going through the steps the server recorded for it; its hand-off flies after that. Access check events apply at once (`live.ts`), because a check can start and end between two ticks.

## 18. Spend ledger and the enforced daily budget

- **Ledger** (`server/ledger.ts`, table `job_runs`). `engine.ts runClaude` reports every CLI run to one listener (`onCliRun`), with the tokens and cost the CLI stated, also for a run that failed, timed out or was cancelled. A job handler wraps its CLI calls in `metered({ kind, jobId, siteId, agent }, fn, used?)`, which is how the run finds its job (AsyncLocalStorage); `used` adds the runs up for the job's own `tokens`/`cost_usd` columns (the latest job, as before). Revisions and retries add rows. The old cost columns are copied in once (`kv` key `ledger:backfilled`).
- **Sums.** `siteSpendToday`, `spendSince`, `spendSnapshot()` (per site: `today`, `tokensToday`, `d7`, `d28`, `tokens28`; per agent today: `tokens`, `cost`, `runs`; `budget`; `day`). Days are local days on the server's clock. The budget alerts (`notify.ts budgetCheck`, on the bus event `run`) and the report (`report.ts`) read the ledger.
- **Hard stop.** `budgetStop(siteId)` returns the 409 message or null; it is checked by `POST /api/requests`, request retry, `createArticle`, `reviseArticle`, `retryArticle`, `findPhotos` and a site's first build (`requestBuild`, while it has no identity). Jobs already queued are held: each queue source picks with `firstAllowed(...)`, so other sites keep running. `watchBudget(kick)` starts held jobs at local midnight and when the settings document changes.
- **API.** `GET /api/state` has `spend` (null for a native reviewer); the event `spend` carries the same snapshot after every run, at midnight and when the budget changes.
- **App** (`app/src/store/spend.ts`). `store.live.spend` holds the snapshot; `spendTo()` (called from `serverFactsTo`) writes `site.spend`, `site.tok28` (millions) and the tokens today of `kw`, `wr` and `bld`. `budgetUsed`, `heldFor` and `HELD_LABEL` ("Waiting for budget") are for any place that shows a queued job. Demo mode keeps the simulation's numbers.
- **Tests.** `server/spend.test.ts` (in process), `server/ledger.test.ts` (a real server with the fake CLI; its control files `cost` and `error`), `app/src/store/spend.test.ts`, `app/src/views/__tests__/spend.test.tsx`.

## 19. Password reset, everyone's sessions, the audit log in pages, alerts in the bell

- **Password reset** (`server/reset.ts`, table `password_resets`). A link is `http://localhost:<port>/reset/<token>`: a random 32-byte token, only its SHA-256 stored, 30 minutes, deleted when used. Two ways to get one: `POST /api/auth/reset/request { email }` (open; always the same 200 answer, sent before the server looks the email up; emails only when Email (SMTP) is usable; at most 3 at once then one per 20 minutes per account, and 20 then one a minute in all, counted only for emails really sent; a request over the limit is dropped silently and never cancels a link already sent), and `POST /api/users/:id/reset-link` (admin, not for yourself, replaces an earlier admin link; the answer is the only time the link exists). `GET /api/auth/reset/:token` says whose it is; `POST /api/auth/reset/:token { password, confirm }` sets the password, deletes the person's other links, ends all their sessions, clears their sign-in lock, writes the audit entry and emails "your password was changed". It does not sign in, so 2-step verification still applies. `GET /api/auth/status` has `resetByEmail`. Changing your own password cancels open links.
- **App**: `shell/Login.tsx` ("Forgot your password?" by email when `resetByEmail`, else the ask-an-admin line), `shell/ResetPassword.tsx` (route `/reset/$token`, open without a session like `/invite/$token`), `views/system/ResetLinkSheet.tsx` (the admin's link, shown once).
- **Everyone's sessions** (`server/auth-api.ts sessionsAdminApi`, admin): `GET /api/sessions`, `DELETE /api/sessions/:id`, `POST /api/users/:id/sign-out` (for yourself: every session but this one). App: `views/system/TeamSessions.tsx` in Team and roles, outside demo mode.
- **Audit log** (`server/audit-api.ts`): `GET /api/audit?before=<id>&limit=<n>&actor=&site=&q=&from=<ms>&to=<ms>` answers `{ audit, more }` (200 entries without `limit`, 500 at most; text filters match anywhere, any case, wildcards taken literally). `GET /api/audit.csv` takes the same filters (admin, editor; up to 50,000 rows; every cell quoted, and a cell starting with `=`, `+`, `-`, `@`, a tab or a line break gets a leading `'`). App: `views/Audit.tsx` shows the store's live entries joined with the pages it fetched (`store/auditApi.ts`); a filter is sent 250 ms after the last keystroke; demo mode filters in the browser.
- **Alerts in the bell**: `GET /api/notifications` (every role but the native reviewer) returns the `alerts` rows of the events `blocked`, `budget` and `report` from the last 30 days, without the events whose In-app box is off. `store/liveAlerts.ts` loads them into `store.live.alerts` when the workspace is loaded and shortly after the stream events `access`, `spend` and `report`; `liveNotifs.ts alertNotifs` turns them into notifications keyed `alert:<server key>`, so the read state (`notif_reads`) works as for every other notification.
- **Tests.** `server/reset.test.ts`, `server/audit.test.ts`, `app/src/auth.test.tsx` (forgotten password, reset link), `app/src/views/__tests__/accounts.test.tsx`, `app/src/store/liveNotifs.test.ts`.

## 20. Editing an article by hand, bulk actions, unapprove and archive

- **Server** (`server/article-edit.ts`, routes in `server/article-api.ts`; admin and editor). `PATCH /api/articles/:id/content { updatedAt, title?, titleTag?, metaDescription?, slug?, blocks? }` edits an article in `review`. A block is `{ from, type, text | items | rows }` in the site's language only; `from` is the block's index before the edit (null for a new block). Limits are parseArticle's, but text over a limit is refused (400 naming the piece), never cut. `updatedAt` is that of the version the person edited: when the text changed after it (another edit, a new version) the answer is 409 and nothing is merged. The English of changed text is kept with `enStale: true` (`titleEnStale` for the title; '' for new text). Photos follow their block (`remapPhotos`); a structural edit is refused (409) while the photo job is running. The checks are recomputed, the history gets `edited` with what changed, and a language review is cleared when the title or body changed. `POST /api/articles/:id/unapprove` (approved → review, checks recomputed, history `unapproved`), `/archive` and `/unarchive` (approved, rejected or failed; sets `articles.archived_at`, sent as `archivedAt`; a display flag only). `POST /api/articles/bulk { requestId, keywords[], model }` (at most 10) answers `{ results: [{ keyword, ok, article | status + error }], created }`; every keyword goes through `createArticle`, so the queue caps and the budget stop apply per keyword.
- **Checks** (`server/checks.ts`). `articleChecks(content, keyword, review, others)`; `checksFor()` in `articles.ts` passes the site's other articles in review or approved. Bad (blocks approval): no source, no title tag, a URL slug another article of the site uses. Warnings: one source, title tag over 60 characters, meta description outside 70–160, a title another article has, under 300 words (Intl.Segmenter, so Thai and Japanese count too), a first-hand testing phrase (short lists per language, plus the English list over the reviewer translation).
- **App**. `views/content/ArticleEditor.tsx` (+ `editing.ts`, `editor.css`) replaces `LiveArticleBody` while "Edit" is on, with the same sections in the same order; the original column keeps the read-only table's width, so the text does not reflow. `store/editGuard.ts` is the unsaved-changes guard: `leaveEdit(run)` runs at once or after "Discard your changes?"; the content slice's `selectArticle`, `setRtab`, `reviewBack`, `setShowArchived` and the router's navigator go through it, and `Review` keeps the edited article selected whatever the list does. Slice actions: `saveArticleEdit`, `unapproveArticle`, `archiveArticle`, `setShowArchived`, `approveSelected` (per-article results with the reason for each skip), `sendArticles`. `Article.archived` hides an article from the review lists unless `showArchived`. `KwResultSheet` has tick boxes and "Write selected (n)"; `WriteArticleSheet` takes `keywords[]` and lists per-keyword results when some were refused.
- **Tests.** `server/article-edit.test.ts` (a real server with the fake CLI), `server/writer.test.ts` (the checks), `app/src/views/content/editing.test.ts`, `app/src/views/__tests__/editor.test.tsx`.

## 24. Custom domains and site status (iteration 2, package J)

- **Server** (`server/domains.ts`, table `site_domains`, Cloudflare calls in `server/cfpages.ts`). After every successful production deploy `builds.ts runDeploy` calls `domainAfterDeploy(siteId)` (not awaited; a domain problem never fails a deploy). It attaches the site's domain to its Pages project (`POST …/pages/projects/<project>/domains`) when it is not attached, and otherwise leaves it as it is, so a new version, a retry and a rollback keep the domain. While Cloudflare does not report the domain active it looks for the zone (`GET /zones?name=`, longest name first): a zone of the same account gets the proxied CNAME to `<project>.pages.dev` (`POST /zones/<id>/dns_records`); a zone elsewhere, in another account, or a token without Zone: Read / DNS: Edit leaves the record to the person (`dnsBy: 'you'`, `record`). **DNS safety:** the only record ever changed is the one whose id Meridian stored when it created it (`record_id`); any other A, AAAA or CNAME at the name stops with `problem: 'conflict'`; nothing is ever deleted (no domain, no record, no project), also not when a site is removed.
- **States.** `status`: `none` → `dns` (Cloudflare's `verification_data` not active) → `cert` (`validation_data` pending, or active but https://domain did not answer from this computer: `problem: 'https'`) → `live`; `error` with `problem` `conflict`, `caa`, `validation`, `in-use`, `token`, `permission` or `account`, and Cloudflare's own words in `message`. `dns` and `cert` are polled by `scheduleDomains()` with backoff (15 s, 30 s, 1, 2, 5, then every 10 minutes) for 24 hours from the attach or the last "Check again" (`problem: 'timeout'` after that); `next_check_at` is stored, so a restart goes on. A background poll only reads the domain; the DNS is looked at after a deploy and on "Check again", which also asks Cloudflare to validate again (`PATCH …/domains/<name>`).
- **Going live.** On the first `live`, `promote()` sets the site's `status` to `live` in the sites document with `putDoc` (a paused site gets `prev: 'live'`), emits `workspace`, writes two audit entries as Deploy & Monitor and starts the first access check (`probe.ts checkSite`); the 6-hourly recheck then applies because the site is live. A site only on `*.pages.dev` stays `build` ("Being set up").
- **API.** `GET /api/state` has `domains` (none for a native reviewer); `GET /api/domains`; `POST /api/sites/:id/domain/check` (admin, editor; counted with the costly actions; 409 before the first deploy or without Cloudflare); stream event `domain`.
- **App.** `store/domains.ts` (`liveDomainTo`, `domainOf`, `domainStep`, `domainNote`, `domainsApi.check`), `store.live.domains` by site id, `views/deploy/DomainStep.tsx` inside each site's Website card (four steps, the message, the record table with Copy, the pages.dev address, "Check again" / "Connect domain"), a note under the status pill in `views/sites/SitesTable.tsx`, and the remove-site confirm says the Pages project, domain and DNS records stay at Cloudflare.
- **Tests.** `server/domains.test.ts` (a real server and the fake Cloudflare: zone in the account, repair of Meridian's own record, live + site status + first access check, deploy and rollback keep the domain, zone elsewhere, restart while pending, HTTPS not answering yet, token without DNS permission, zone in another account, 24-hour stop, conflicting record, CAA and other validation errors, TXT validation, domain in use, roles, removing a site), `server/cfpages.test.ts` (the calls themselves), `app/src/views/__tests__/domain.test.tsx`. The fake (`server/fixtures/fake-cloudflare.ts`) records every delete, every PUT and every change to a record Meridian did not create in `cf.problems`. Test knobs: `MERIDIAN_DOMAIN_POLL_MS`, `MERIDIAN_DOMAIN_GIVE_UP_MS`, `MERIDIAN_DOMAIN_HTTPS_URL`.

## 25. Workflow engine and schedules (iteration 2, package G)

- **Server** (`server/workflows.ts`, `workflow-time.ts`, `workflow-api.ts`, table `workflow_runs`). A run is a row and a state machine in code, with no model call: `research → write ⇄ review → build → approve → deploy → done`. `advance(id)` looks at the rows of the jobs the run queued and moves it as far as it can; it is called when the run starts, a moment after every `request`, `article` and `build` event of the run's site, when Settings or Sites are saved (a raised budget), and every minute. Jobs are made with the functions a person's click uses: `createRequest` (new, in `requests.ts`), `createArticle`, `requestBuild`; `approveBuild` queues the deploy as before. `candidates()` picks keywords of the finished research that have no article of the site, by `keywords.volume` when any keyword has one, else in the agent's order. `wait` on a running run is `{ kind: agent | person | budget | queue, text, detail? }`. A failed step ends the run `failed` with the reason in `error`; other endings are `done` with `outcome` (live, approved without Cloudflare, build rejected, nothing approved, nothing to write) or `cancelled`. `cancelRun` withdraws the jobs the run queued that have not started (`withdrawRequest`, `withdrawArticle`, `withdrawBuild`: status `failed` with "Cancelled with its workflow before it started.", no end time, so no alert and "Run again" still works).
- **Schedules.** The `schedules` document: `{ id, wf: "Weekly content", site, on, every: week | 2weeks | month, weekday: 0-6, hour: 0-23, n: 1-5, topic }` (`cad` is demo mode's field; an item without `every`/`weekday`/`hour` is never run). `schedulerPass()` runs every minute and when the document is saved. Per schedule it keeps `{ sig, seen, fired, note }` in `kv` (`workflow:schedule:<id>`), written before a run starts: a schedule that is new, changed or turned on counts from now; a slot more than 6 hours old is skipped with a note; a site with a run still running, a paused site and Claude Code not signed in are notes too. Time zones: `zoneOf(cc)` in `workflow-time.ts`, else the server's. `MERIDIAN_SCHEDULER_NOW` and `MERIDIAN_SCHEDULER_TICK_MS` are for tests.
- **API.** `GET /api/workflows` → `{ runs, schedules: [{ id, siteId, zone, nextDue, lastDue, note }] }` (also `workflows` in `GET /api/state`; 403 / null for a native reviewer); `POST /api/workflows { siteId, n, topic }` or `{ scheduleId }` (admin, editor; 409 while the site has a run, 503 without the engine, 429 when the queue is full); `POST /api/workflows/:id/cancel`. Stream event `workflow`: `{ run }` or `{ schedules }`.
- **App.** `store/liveWorkflows.ts` (`workflowTo`, `workflowsTo`, `schedDueTo`, `orchestratorTo`, `FLOW`, `stepStates`, `cadenceText`, `zoneTime`, `realSchedule`), `store/workflowApi.ts`, `store.live.workflows` by id and `store.live.schedDue` by schedule id; sites slice: `runWorkflow`, `cancelWorkflow`, `runSchedule`, `saveSchedule`, `removeSchedule`. `views/workflows/`: `LiveWorkflows.tsx` (the tab outside demo mode), `RunCard.tsx`, `SchedulesSection.tsx`, `ScheduleSheet.tsx`, `RunSheet.tsx`, `WorkspaceRuns.tsx` (a line per running workflow above the Workspace's pipeline), `workflows.css`. Demo mode keeps the prototype's Workflows screen.
- **Orchestrator.** `orc` is in `RUNNER_AGENTS`, so it is no longer "Planned". `orchestratorTo` (called from `liveAgentsTo`) shows the running workflow on its desk, the one waiting for a person first: status `wait` ("Needs approval", the meeting room) with the task "Weekly content for kopi.example · waiting for your review of 2 articles", else `work` with the step after the task. It shows "Runs as code" instead of a model and has no tokens.
- **Tests.** `server/workflows.test.ts` (time rules across zones and clock changes; a full run through both human waits with the fake CLI and the fake Cloudflare; cancel; budget hold and resume; a failed step; roles; schedules across six restarts), `app/src/store/liveWorkflows.test.ts`, `app/src/views/__tests__/workflows.test.tsx`.

## 26. Insights data: Search Console detail, rank tracking, keyword volumes, GA4 (iteration 2, package I)

- **Search Console rows** (`server/google.ts` `gscDaily`/`gscDetail`, `server/metrics.ts`, table `gsc_rows`). Besides the 6-hourly totals per site (unchanged, in `kv`), once a day (and on connect and on `POST /api/metrics/refresh`) each site with a property gets two `searchAnalytics.query` calls for web search, final data, ending 3 days ago: by `date` alone (the day's true totals, stored with an empty page and query) and by `date, page, query` paged by `startRow` (25,000 a request, at most 200,000 rows). 28 days are fetched, 56 the first time; rows older than 16 months are pruned. A 401 renews the token once and repeats the call; a used-up quota (`QuotaError`) keeps the stored data and does not mark the connection broken; an ended sign-in does. `siteSearch(siteId)` gives `state` (`not-connected`, `waiting`, `no-property`, `no-data`, `ok`), totals, the 28 days, and the top 25 pages and queries (position weighted by impressions).
- **Rank tracking** (`server/rank.ts`). Tracked keywords of a site: the keywords of its approved, not archived articles, plus research keywords with `keywords.track = 1` (`POST /api/keywords/:id/track`). Position now is the impression-weighted average over the newest 7 days of rows for the query; `change7` and `change28` compare with the 7 days before and the 7 days that ended 28 days earlier (positive: moved up; null when a window has no impressions). `rankEffects()` gives each deploy (`site_builds.deployed_at`) the average over tracked keywords of (position in the 7 days before) minus (position in the 7 days after), only for keywords with both and only once Search Console has the 7th day.
- **Keyword volumes** (`server/dataforseo.ts`, `server/requests.ts`). When DataForSEO is stored and its last test did not fail, `runRequest` asks `keywords_data/google_ads/search_volume/live` once after the agent's result (one task, the site's `location_code` = 2000 + ISO numeric or `location_name`, `language_name` from the site, left out when DataForSEO answers 40501 for it) and stores `volume`, `competition`, `volume_at` on the keywords. The cost in the answer is written to the ledger (`recordRun`, agent Keyword, model "DataForSEO search volume", 0 tokens), so it counts for the daily budget; a held budget skips the call. A failure never fails the research: the notes say why. `POST /api/requests/:id/volumes` is "Refresh volumes" (budget stop, costly-action allowance, 12 requests a minute).
- **GA4** (`server/ga4.ts`, table `ga4_rows`, `kv` keys `ga4:props`, `ga4:map`, `ga4:status`). `accountSummaries` (paged) and each property's `dataStreams` give the properties and their web hosts; a site is matched by its domain, and `POST /api/ga4/map` stores a person's choice, which wins. Once a day (and on connect, on `POST /api/ga4/refresh`, and after a choice) two `runReport` calls per mapped site, one after the other: `activeUsers`, `sessions`, `engagedSessions` by `date` with `metricAggregations: TOTAL` (users do not add up by day) and by `pagePath`, paged by `offset` up to `rowCount`.
- **API.** `GET /api/metrics/site/:id` (`{ gsc, ga4 }`), `GET /api/rank` (`{ connected, sites, effects }`), `GET /api/ga4`, the three POSTs above and the track route are in `server/insights-api.ts`; native reviewers get 403 on all of them, writes need admin or editor. Stream event `insights` (not sent to reviewers) tells open tabs to read again. `viewRequest` keywords carry `id`, `volume`, `competition`, `volumeAt`, `track`.
- **App.** `store/insightsApi.ts` holds the wire types, the calls and three TanStack Query hooks (`useSiteInsights`, `useRank`, `useGa4`) under the key `['live', 'insights']`; `live.ts` invalidates it on `insights` and `metrics`. Nothing is copied into the store, and demo mode never calls the server. `views/system/SourceTab.tsx` shows `SearchConsole.tsx` or `Ga4.tsx` outside demo mode (per-site table, a site picker that follows the top-bar site filter, tiles, `DayChart.tsx`, top pages and queries); `views/Rank.tsx` shows the tracked keywords with `Change` arrows and `RankHeat` drawn from `liveHeatRows()` (countries by the agent's five intents); `views/research/RankEffect.tsx` is the "Rank +0.9" pill on `views/deploy/BuildTimeline.tsx`. `KwResultSheet.tsx` adds Volume/mo and Competition (only when a keyword of the result was asked for), a Track checkbox and "Refresh volumes" (only when DataForSEO is usable); the Keywords table shows Volume through `volumeText()` in `liveApply.ts` ("n/a" never asked: the column hides itself; "—" asked, no figure).
- **`DayChart`.** One measure per day: a 2px line over a soft area from zero, HTML axis labels (text never stretches), a crosshair with a tooltip under the pointer or the arrow keys, and the same days in a visually hidden table. One series, so no legend; the caption names it.
- **Tests.** `server/insights.test.ts` (a real server with `fixtures/fake-google.ts` and `fixtures/fake-dataforseo.ts`: paging, token renewal, quota and API errors, retention, mapping, roles, the ledger row, the budget stop), `server/insights-unit.test.ts`, `app/src/views/__tests__/insights.test.tsx`.

## 27. Internal links and categories (iteration 2, package H)

- **Links are data, never HTML.** `ArticleLink` (`store/types.ts`, the server's `Link` in `server/article-content.ts`) is `{ start, end, article }` or `{ start, end, url }`: a range of a paragraph's or a list item's `text` and a target. `Linked` and `LinkList` (`views/content/LiveArticleBody.tsx`) render them: text between links is plain text, a web address is an `<a>` only when it is http(s), a link to another article is a marked `<span>` that says where it leads. A range that does not hold is skipped.
- **Editor.** The text stays in plain text boxes; links are ranges moved along while the person types (`shiftLinks`), split with the text (`sliceLinks`), and sent with positions in the collapsed text (`collapsed`, all in `views/content/editing.ts`). The link button beside a paragraph or list (or Ctrl/Cmd+K) opens `LinkForm` for the selected words: an article of the site (from `GET /api/sites/:id/links`) or a web address. A block is sent with `links` only when it has some; text sent without links has none after the save. `ArticleEditBody.category` carries the category (an input with the site's categories as suggestions). The site's articles and categories are read only when the person first reaches for a link or the category.
- **Server.** `parseAnswer` validates the agent's links (anchors found in the text, no overlaps, targets among the site's articles or listed sources, once per target, at most `MAX_LINKS` = 8) and reads the proposed category; `article-edit.ts` holds a person's links to the same rules but refuses with a message instead of dropping. `articles.category` is a column (default: the keyword's research cluster). `links.ts` computes the graph, orphans and categories; `links-api.ts` serves `GET /api/sites/:id/links` and `POST /api/sites/:id/categories` (`{ from, to }` renames or merges, `{ articleId, to }` moves one article). Not for native reviewers; writes need `mayWrite`.
- **Views.** `useSiteLinks(siteId)` (`views/research/siteLinks.ts`) reads the graph while the page is on the server and not in demo mode, again whenever an article of the site changes. `Links.tsx` draws it with `buildSiteGraph` (`graph.ts`, deterministic layout) and lists orphans with where to write a link from; `Architecture.tsx` shows `CategoryTree` (rename, merge with a warning, move an article). Demo mode and the page without a server keep the prototype's graph, silo tree and wording.
- **Built site** (`server/sitebuild.ts`): category pages, three-level breadcrumbs matching `BreadcrumbList`, related articles, categories in the navigation and on the home page from two categories on, category pages in the sitemap; a link to an article that is not in the build is plain text. `checkSite` also catches links without text, nested links and breadcrumbs that name a page that is not there. Article URLs do not change.
- **Tests.** `server/links.test.ts` (parser against hostile input, checks, prompt, graph, built site), `server/links-api.test.ts` (a real server with the fake CLI), `app/src/views/content/editing.test.ts`, `app/src/views/__tests__/links.test.tsx`.
