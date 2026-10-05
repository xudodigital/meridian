import { useState } from 'react';
import { Button, Callout, Empty, Pill, SiteChip, Table } from '@/components';
import { go } from '@/nav';
import { refreshEngine } from '@/store/live';
import { REQ_ST, liveOn as liveOnOf, siteShown, stamp } from '@/store/rules';
import { usableInt } from '@/store/serverFacts';
import { NO_SERVER } from '@/store/slices/research';
import { HELD_LABEL, heldFor } from '@/store/spend';
import { useStore, useStoreShallow } from '@/store/store';
import type { EngineStatus, KwRequest } from '@/store/types';
import { KwRequestSheet } from './KwRequestSheet';
import { KwResultSheet } from './KwResultSheet';

/**
 * The prototype's kwReqHTML(), above the Keywords table: the "New research request" button and the requests table.
 * When the page is served by the local server (live mode) it also shows the engine callout, who did each request and
 * the result sheet. A server request whose site is not in the store is listed with the domain stored on it.
 */
export function KwRequests() {
  const [kwReqs, sites, siteFilter] = useStoreShallow(s => [s.kwReqs, s.sites, s.siteFilter] as const);
  const liveOn = useStore(liveOnOf);
  const engine = useStore(s => s.live.engine);
  const sample = useStore(s => s.sample);
  const [formOpen, setFormOpen] = useState(false);
  const [resultRid, setResultRid] = useState<number | null>(null);
  const list = kwReqs.filter(r => siteShown({ sites, siteFilter }, r.site, r.domain));

  /* Opening the form is a change action in the prototype ("form"), so it is refused for viewers. A request needs a site. */
  const openForm = () => {
    const st = useStore.getState();
    if (!st.guard()) return;
    if (sites.length) setFormOpen(true); else st.snack('Add a domain in Sites first. A request is researched for one site.', 'info');
  };

  return (
    <>
      {liveOn ? <EngineCallout engine={engine} /> : sample ? null : <Callout icon="cloud_off" warn><b>Research requests cannot run.</b> {NO_SERVER}</Callout>}
      {sites.length ? null : (
        <Empty icon="travel_explore" title="Add a site first" action={<Button variant="tonal" icon="language" onClick={() => go('sites')}>Open Sites</Button>}>
          Research is done for one site at a time, in its country and language. Add your first domain, then send a request here.
        </Empty>
      )}
      {list.length ? (
        <section>
          <div className="sh"><h2>Research requests</h2><Button variant="filled" icon="add" onClick={openForm}>New research request</Button></div>
          {liveOn ? <LiveTable list={list.slice(0, 12)} onOpen={setResultRid} /> : <SimTable list={list.slice(0, 8)} />}
          <p className="note">
            {liveOn
              ? 'Requests run one at a time, oldest first. Keywords from finished requests are added to the Keywords table below.'
              : 'The Keyword agent takes the oldest queued request as soon as it is free. In demo mode the request is tracked only; no keywords are researched.'}
          </p>
        </section>
      ) : sites.length ? (
        <section>
          <div className="sh"><h2>Research requests</h2><Button variant="filled" icon="add" onClick={openForm}>New research request</Button></div>
          <Empty icon="key" title="No research requests yet" action={<Button variant="tonal" icon="add" onClick={openForm}>New research request</Button>}>
            Give the Keyword agent a topic for one of your sites. It proposes keywords in that site's country and language.
          </Empty>
        </section>
      ) : null}
      <KwRequestSheet open={formOpen} onClose={() => setFormOpen(false)} />
      <KwResultSheet rid={resultRid} onClose={() => setResultRid(null)} />
    </>
  );
}

/** "Live mode" when OpenAI is signed in, otherwise how to sign it in, with the "Check again" action (eng-refresh). */
function EngineCallout({ engine }: { engine: EngineStatus | null }) {
  const dfs = useStore(st => usableInt(st, 'dfs'));
  if (engine?.ready && engine.mode !== 'none') {
    return (
      <Callout icon="bolt" info>
        <b>Live mode.</b> {'Requests are done by the Keyword agent through ' + (engine.mode === 'codex-local' ? 'Codex local (ChatGPT usage limits)' : 'OpenAI Responses API') + '. ' + (dfs ? 'Search volume comes from DataForSEO (Google Ads data) after each research; keyword difficulty is not shown.' : 'Search volume is not shown: connect DataForSEO in Integrations to add it. Keyword difficulty is not shown.')}
      </Callout>
    );
  }
  const check = () => { if (useStore.getState().guard()) void refreshEngine(); };
  return (
    <Callout icon="key_off" warn>
      {engine?.mode === 'codex-local' ? <><b>Codex local is not ready.</b> {engine.reason || 'Sign in to Codex on this computer, then check again.'}</> : <><b>OpenAI is not connected.</b> Add and test the API key in Integrations, then try again. Until then requests are refused, so nothing is made up.</>}{' '}
      <Button variant="text" size="sm" onClick={check}>Check again</Button>
    </Callout>
  );
}

function StatusPill({ r }: { r: KwRequest }) {
  const [kind, label] = REQ_ST[r.st];
  /* A queued request of a site that used its daily budget is held by the server until midnight or a higher budget. */
  const held = useStore(s => r.st === 'queued' ? heldFor(s, r.site, r.domain) : null);
  if (held) return <><Pill kind="warn">{HELD_LABEL}</Pill> <span className="note">{held}</span></>;
  return <Pill kind={kind} live={r.st === 'work'}>{label}</Pill>;
}

function SimTable({ list }: { list: KwRequest[] }) {
  return (
    <Table
      cols={['Topic', 'Site', 'Goal', 'Requested', 'Status']}
      rowKey={(_, i) => String(list[i].id)}
      rows={list.map(r => [<b>{r.topic}</b>, <SiteChip id={r.site} domain={r.domain} />, r.goal, stamp(r.t), <StatusPill r={r} />])}
    />
  );
}

function LiveTable({ list, onOpen }: { list: KwRequest[]; onOpen: (rid: number) => void }) {
  const doneBy = (r: KwRequest) => r.engine === 'codex-local' ? 'Codex local' : r.engine === 'openai-api' ? 'OpenAI' : '';
  const action = (r: KwRequest) => {
    const rid = r.rid;
    if ((r.st !== 'done' && r.st !== 'failed') || rid == null) return null;
    return <Button variant="text" size="sm" onClick={() => onOpen(rid)}>{r.st === 'done' ? 'View result' : 'View error'}</Button>;
  };
  return (
    <Table
      cols={['Topic', 'Site', 'Goal', 'Requested', 'Status', 'Done by', 'Actions']}
      rowKey={(_, i) => String(list[i].id)}
      rows={list.map(r => [
        <b>{r.topic}</b>,
        <SiteChip id={r.site} domain={r.domain} />,
        r.goal,
        r.by ? <>{stamp(r.t)}<span className="sub2">by {r.by}</span></> : stamp(r.t),
        <><StatusPill r={r} />{r.st === 'work' && r.step ? <> <span className="note">{r.step}</span></> : null}</>,
        doneBy(r),
        action(r),
      ])}
    />
  );
}
