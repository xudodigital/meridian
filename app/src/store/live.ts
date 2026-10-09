import type { SeoTaskWire } from '../../../shared/seo-tasks';
/* Live mode: the server's research requests, articles and engine status, and the event stream.

   After sign-in, GET /api/state (TanStack Query, one query per session) -> store.live.reqs, store.live.arts and
   store.live.builds -> liveApply() (liveApply.ts) rebuilds kwReqs, the live keyword rows, the real articles, the `live`
   flag of the agents that run real jobs, the job log and notifications. The event stream /api/events then feeds
   single requests, articles (their photos too), website builds and engine changes through the same path, plus the
   workspace events sync.ts applies (documents, audit entries, read notifications, a reset), team and account changes,
   and "signed-out" when the session ends. Demo mode keeps the server's data out of the store: it is simulated in the
   browser only. */
import { useEffect, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENDED_NOTE, refreshMe } from './auth';
import { authApi } from './authApi';
import { snackTo } from './draft';
import { liveApply, liveArticleTo } from './liveApply';
import { liveBuildTo } from './liveBuilds';
import { schedDueTo, workflowTo, workflowsTo } from './liveWorkflows';
import { liveDomainTo } from './domains';
import { siteById } from './rules';
import { apiGet, apiSend } from './serverApi';
import { insightsStale } from './insightsApi';
import { liveAgentsTo } from './liveAgents';
import { alertsSoon, refreshAlerts } from './liveAlerts';
import { serverFactsTo } from './serverFacts';
import { servicesApi } from './servicesApi';
import { useStore } from './store';
import { remoteAudit, remoteDoc, remoteReads, remoteReset, resyncWorkspace, type AuditWire } from './sync';
import type { ScheduleDueWire, WorkflowWire } from './types';
import type { AccessWire, BuildWire, DomainWire, EngineStatus, IntegrationWire, MetricsWire, NewRequestBody, ServerArticle, ServerRequest, ServerState, SpendWire, VerifyWire } from './types';
import { DOC_IDS, type DocId, type Json } from './workspace';

export { liveApply };

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
export const LIVE_KEY = ['live', 'state'] as const;

/** Live mode is only tried on a local http(s) origin, as in the prototype. */
export const liveCapable = (): boolean =>
  typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

/* ---------- Store side ---------- */

/** First answer from the server: live mode is on. Demo mode keeps the data aside without showing it. */
function liveInit(data: ServerState): void {
  useStore.setState(d => {
    d.live.on = true; d.live.engine = data.engine;
    d.live.seoTasks = byKey(data.seoTasks ?? [], t => String(t.id));
    data.requests.forEach(r => { d.live.reqs[r.id] = r; });
    (data.articles ?? []).forEach(a => { d.live.arts[a.id] = a; });
    d.live.ints = byKey(data.integrations ?? [], w => w.id);
    d.live.access = byKey(data.access ?? [], c => c.siteId);
    d.live.verify = byKey(data.verify ?? [], v => v.siteId);
    d.live.metrics = data.metrics ?? null;
    d.live.builds = Object.fromEntries((data.builds ?? []).map(b => [b.id, b]));
    d.live.domains = byKey(data.domains ?? [], x => x.siteId);
    d.live.spend = data.spend ?? null;
    workflowsTo(d, data.workflows);
    if (!d.sample) { d.checking = data.checking ?? []; liveApply(d); serverFactsTo(d); d.live.ready = true; }
  });
}
const byKey = <T,>(list: T[], key: (x: T) => string): Record<string, T> => Object.fromEntries(list.map(x => [key(x), x]));

/**
 * A fresh snapshot after the event stream was away: everything the server owns is replaced by what it has now, so
 * work that finished meanwhile shows, and nothing that was removed lingers. The article that is open keeps the newer
 * of the two versions (liveArticleTo), like an event would.
 */
function liveResync(data: ServerState): void {
  useStore.setState(d => {
    d.live.engine = data.engine;
    d.live.seoTasks = byKey(data.seoTasks ?? [], t => String(t.id));
    d.live.reqs = byKey(data.requests, r => String(r.id));
    const arts = data.articles ?? [];
    for (const id of Object.keys(d.live.arts)) if (!arts.some(a => String(a.id) === id)) delete d.live.arts[Number(id)];
    for (const a of arts) { const known = d.live.arts[a.id]; if (!known || known.updatedAt <= a.updatedAt) d.live.arts[a.id] = a; }
    d.live.ints = byKey(data.integrations ?? [], w => w.id);
    d.live.access = byKey(data.access ?? [], c => c.siteId);
    d.live.verify = byKey(data.verify ?? [], v => v.siteId);
    d.live.metrics = data.metrics ?? null;
    d.live.builds = Object.fromEntries((data.builds ?? []).map(b => [b.id, b]));
    d.live.domains = byKey(data.domains ?? [], x => x.siteId);
    d.live.spend = data.spend ?? null;
    workflowsTo(d, data.workflows);
    if (!d.sample) { d.checking = data.checking ?? []; liveApply(d); serverFactsTo(d); }
  });
}

/** How long without any event (the server pings every 25 s) before the stream counts as dead and is reopened. */
export const STREAM_SILENT_MS = 80_000;
/** A tab hidden for longer than this catches up when it is shown again. */
const HIDDEN_RESYNC_MS = 60_000;

/**
 * Catches up with the server after the stream was away: the state snapshot and the workspace documents. Called when
 * the stream reconnects (events in between were lost), after a long time hidden, and when the stream is reopened by
 * the watchdog. Failures are left to the next try; an ended session is handled by the API layer.
 */
export async function resyncLive(qc: QueryClient, sid: string): Promise<void> {
  if (!useStore.getState().live.on) return;
  try {
    const data = await qc.fetchQuery({ queryKey: [...LIVE_KEY, sid], queryFn: () => apiGet<ServerState>('/api/state'), staleTime: 0 });
    if (useStore.getState().session?.id !== sid) return;
    liveResync(data);
    await Promise.all([refreshIntegrations(), resyncWorkspace(), refreshAlerts(), qc.invalidateQueries({ queryKey: REPORT_KEY })]);
    if (useStore.getState().teamLoaded) void useStore.getState().loadTeam();
  } catch { /* the next event, ping or reconnect tries again */ }
}

/* ---------- Services and checks (serverFacts.ts puts them into the cards and sites) ---------- */

/** Loads the services again (after a change from any browser), with the redirect URI for Google sign-in. */
export async function refreshIntegrations(): Promise<void> {
  try {
    const r = await servicesApi.integrations();
    useStore.setState(d => { d.live.ints = byKey(r.integrations, w => w.id); d.live.redirectUri = r.redirectUri; serverFactsTo(d); });
  } catch { /* the next event or reload tries again */ }
}
export function integrationTo(w: IntegrationWire): void { useStore.setState(d => { d.live.ints[w.id] = w; serverFactsTo(d); }); }
/* An access check can start and end within a few milliseconds (a domain that does not resolve), between two ticks of
   the simulation: each change puts it on Deploy & Monitor at once, so the Workspace shows it (liveAgents.ts). */
function accessTo(c: AccessWire): void {
  useStore.setState(d => { d.live.access[c.siteId] = c; serverFactsTo(d); if (!d.sample && d.live.ready) liveAgentsTo(d); });
}
function runningTo(siteId: string, on: boolean): void {
  useStore.setState(d => {
    if (d.sample) return;
    d.checking = d.checking.filter(x => x !== siteId); if (on) d.checking.push(siteId);
    if (d.live.ready) liveAgentsTo(d);
  });
}
export function verifyTo(v: VerifyWire): void { useStore.setState(d => { d.live.verify[v.siteId] = v; }); }
function metricsTo(m: MetricsWire | null): void { useStore.setState(d => { d.live.metrics = m; serverFactsTo(d); }); }
/** The spend ledger's sums after a run, at midnight or when the budget changed (spend.ts puts them on sites and agents). */
export function spendWireTo(sp: SpendWire | null): void { useStore.setState(d => { d.live.spend = sp; serverFactsTo(d); }); }
/** The weekly report is cached per session; a sent report or a finished job makes it stale. */
export const REPORT_KEY = ['live', 'report'] as const;
function liveRequest(r: ServerRequest): void { useStore.setState(d => { d.live.reqs[r.id] = r; if (!d.sample) liveApply(d); }); }
function liveArticle(a: ServerArticle): void { useStore.setState(d => { if (d.sample) d.live.arts[a.id] = a; else liveArticleTo(d, a); }); }
function liveEngine(e: EngineStatus): void { useStore.setState(d => { d.live.engine = e; }); }
/** A website build as the server now has it: kept by id, the newest change wins (liveBuilds.ts). */
function liveBuild(b: BuildWire): void { useStore.setState(d => { liveBuildTo(d, b); }); }

/* ---------- Actions for screens ---------- */

/**
 * Sends a keyword research request to the server (live mode). Resolves when the server accepted it; the server writes
 * the audit log under the signed-in person, and the snackbar is shown here. Rejects with the server's message (show
 * it in the form), for example when OpenAI API is not connected.
 */
export async function sendRequest(input: { siteId: string; topic: string; goal: string }): Promise<void> {
  const s = useStore.getState(), sx = siteById(s, input.siteId);
  if (!sx) throw new Error('Choose a site.');
  const kwa = s.agents.find(a => a.id === 'kw');
  const body: NewRequestBody = { siteId: sx.id, domain: sx.domain, country: sx.country, lang: sx.lang, siteTopic: sx.topic || '', topic: input.topic, goal: input.goal, model: kwa ? kwa.model : '' };
  const accepted = await apiSend<{ request: ServerRequest }>('/api/requests', body);
  /* An event may arrive before the POST answer: keep that newer state instead of replacing it with "queued". */
  if (accepted.request && !useStore.getState().live.reqs[accepted.request.id]) liveRequest(accepted.request);
  useStore.setState(d => { snackTo(d, 'Request sent to the Keyword agent.', 'search'); });
}

/** Admin-only, persisted server selection; refuses switching while jobs are queued or running. */
export async function selectEngine(mode: string): Promise<EngineStatus | null> {
  try {
    const d = await apiSend<{engine:EngineStatus}>('/api/engine/select',{mode});
    liveEngine(d.engine);
    useStore.getState().snack(d.engine.ready ? 'Agent engine updated.' : d.engine.reason || 'Engine selected; setup is still needed.', d.engine.ready ? 'check' : 'info');
    return d.engine;
  } catch (e) { useStore.getState().snack((e as Error).message,'error'); return null; }
}

/** Queues a finished or failed request again ("Run again"). Shows the prototype's snackbar either way; resolves to true on success. */
export async function retryRequest(rid: number): Promise<boolean> {
  try {
    await apiSend<{ ok: true }>('/api/requests/' + rid + '/retry');
    useStore.getState().snack('Request queued again.', 'refresh'); return true;
  } catch (e) { useStore.getState().snack((e as Error).message, 'error'); return false; }
}

/** Asks the server to check again whether OpenAI API is connected ("Check again"). */
export async function refreshEngine(): Promise<EngineStatus | null> {
  try {
    const d = await apiSend<{ engine: EngineStatus }>('/api/engine/refresh');
    liveEngine(d.engine);
    const on = d.engine.ready;
    const local = d.engine.mode === 'codex-local';
    useStore.getState().snack(on ? d.engine.mode === 'gemma-local' ? 'Gemma localhost is ready. Agents can run.' : local ? 'Codex local is ready. Agents can run.' : 'OpenAI is connected. Agents can run.' : d.engine.reason || 'The engine is not ready. Check Integrations.', on ? 'bolt' : 'info');
    return d.engine;
  } catch (e) { useStore.getState().snack((e as Error).message, 'error'); return null; }
}

/* ---------- React bindings ---------- */

const isDoc = (v: unknown): v is DocId => typeof v === 'string' && (DOC_IDS as readonly string[]).includes(v);

/**
 * Mount once (App does). After sign-in it loads the server's state and follows the event stream; at sign-out both
 * stop and the state is dropped. While 2-step setup is required nothing is loaded.
 */
export function useLiveMode(): void {
  const qc = useQueryClient();
  const sid = useStore(s => s.session && !s.session.enroll ? s.session.id : null);
  const { data } = useQuery({ queryKey: [...LIVE_KEY, sid], queryFn: () => apiGet<ServerState>('/api/state'), enabled: liveCapable() && !!sid, staleTime: Infinity, gcTime: 0 });

  useEffect(() => { if (data && !useStore.getState().live.on) { liveInit(data); void refreshIntegrations(); } }, [data]);
  useEffect(() => { if (!sid) qc.removeQueries({ queryKey: LIVE_KEY }); }, [sid, qc]);

  /* Bumped to reopen the stream (the watchdog found it silent). */
  const [streamGen, setStreamGen] = useState(0);
  useEffect(() => {
    if (!sid || !liveCapable() || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    /* The stream is alive while events (the server's pings count) keep coming; a reconnect catches up on what was missed. */
    let lastEvent = Date.now(), opened = false, hiddenAt = 0;
    es.addEventListener('ping', () => { lastEvent = Date.now(); });
    es.addEventListener('open', () => { lastEvent = Date.now(); if (opened) void resyncLive(qc, sid); opened = true; });
    const watchdog = setInterval(() => {
      if (Date.now() - lastEvent < STREAM_SILENT_MS) return;
      es.close(); void resyncLive(qc, sid); setStreamGen(g => g + 1);
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > HIDDEN_RESYNC_MS) void resyncLive(qc, sid);
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisible);
    const on = <T,>(event: string, fn: (v: T) => void) => es.addEventListener(event, (e: MessageEvent<string>) => { lastEvent = Date.now(); fn(JSON.parse(e.data) as T); });
    on<SeoTaskWire>('seo-task', task => { useStore.setState(d => { d.live.seoTasks ??= {}; d.live.seoTasks[task.id] = task; if (!d.sample) liveApply(d); }); });
    on<ServerRequest>('request', r => {
      liveRequest(r);
      if (r.finishedAt) void qc.invalidateQueries({ queryKey: REPORT_KEY });
      qc.setQueryData<ServerState>([...LIVE_KEY, sid], old => old && { ...old, requests: [r, ...old.requests.filter(x => x.id !== r.id)] });
    });
    on<ServerArticle>('article', a => {
      liveArticle(a);
      void qc.invalidateQueries({ queryKey: REPORT_KEY });
      qc.setQueryData<ServerState>([...LIVE_KEY, sid], old => old && { ...old, articles: [a, ...(old.articles ?? []).filter(x => x.id !== a.id)] });
    });
    on<BuildWire>('build', b => {
      liveBuild(b);
      qc.setQueryData<ServerState>([...LIVE_KEY, sid], old => old && { ...old, builds: [b, ...(old.builds ?? []).filter(x => x.id !== b.id)] });
    });
    on<DomainWire>('domain', x => {
      useStore.setState(d => { liveDomainTo(d, x); });
      qc.setQueryData<ServerState>([...LIVE_KEY, sid], old => old && { ...old, domains: [x, ...(old.domains ?? []).filter(y => y.siteId !== x.siteId)] });
    });
    /* A workflow run changed, or the schedules' next start times did (server/workflows.ts). */
    on<{ run?: WorkflowWire; schedules?: ScheduleDueWire[] }>('workflow', w => {
      useStore.setState(d => { if (w.run) workflowTo(d, w.run); if (w.schedules) schedDueTo(d, w.schedules); });
    });
    on<EngineStatus>('engine', engine => {
      liveEngine(engine);
      qc.setQueryData<ServerState>([...LIVE_KEY, sid], old => old && { ...old, engine });
    });
    on<{ doc: string; version: number; data: Json | null }>('workspace', w => { if (isDoc(w.doc)) remoteDoc(w.doc, w.version, w.data); });
    on<AuditWire>('audit', remoteAudit);
    on<{ keys: string[] }>('reads', r => remoteReads(r.keys));
    on<Record<string, never>>('reset', () => remoteReset());
    on<Record<string, never>>('team', () => { if (useStore.getState().teamLoaded) void useStore.getState().loadTeam(); });
    on<Record<string, never>>('account', () => { void refreshMe(); });
    on<Record<string, never>>('integrations', () => { void refreshIntegrations(); });
    on<AccessWire>('access', c => { accessTo(c); alertsSoon(); void qc.invalidateQueries({ queryKey: REPORT_KEY }); });
    on<{ siteId: string; running: boolean }>('access-running', r => runningTo(r.siteId, r.running));
    on<VerifyWire>('verify', verifyTo);
    on<VerifyWire[]>('verify-list', list => { useStore.setState(d => { d.live.verify = byKey(list, v => v.siteId); }); });
    on<MetricsWire | null>('metrics', m => { metricsTo(m); void qc.invalidateQueries({ queryKey: REPORT_KEY }); void insightsStale(qc); });
    /* Search Console rows, Analytics figures or the tracked keywords changed (insightsApi.ts): open tabs read again. */
    on<unknown>('insights', () => { void insightsStale(qc); });
    on<unknown>('report', () => { alertsSoon(); void qc.invalidateQueries({ queryKey: REPORT_KEY }); });
    on<SpendWire>('spend', sp => {
      spendWireTo(sp);
      /* A recorded run is what takes a site to 80% or 100% of its budget: the bell asks for the alert. */
      alertsSoon();
      qc.setQueryData<ServerState>([...LIVE_KEY, sid], old => old && { ...old, spend: sp });
    });
    on<{ ok: boolean; msg: string }>('google-result', r => { useStore.getState().snack(r.msg, r.ok ? 'link' : 'error'); });
    on<Record<string, never>>('signed-out', () => { es.close(); useStore.getState().signOut(ENDED_NOTE, false); });
    /* An HTTP error closes the stream for good: ask whether the session is still there. */
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED) return;
      void authApi.status().then(st => { if (!st.me && useStore.getState().session) useStore.getState().signOut(ENDED_NOTE, false); }, () => undefined);
    };
    return () => { es.close(); clearInterval(watchdog); document.removeEventListener('visibilitychange', onVisible); };
  }, [sid, qc, streamGen]);
}

/** Mutation wrappers, for forms that want pending and error state: const m = useSendRequest(); m.mutate({...}). */
export const useSendRequest = () => useMutation({ mutationFn: sendRequest });
export const useRetryRequest = () => useMutation({ mutationFn: retryRequest });
export const useRefreshEngine = () => useMutation({ mutationFn: refreshEngine });
