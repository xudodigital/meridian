import { useState } from 'react';
import { Button, Empty, Info, Pill, SiteChip, Table, Tile, Tiles } from '@/components';
import { go } from '@/nav';
import { fmtDur, inSite, short, stamp } from '@/store/rules';
import { useStore } from '@/store/store';
import type { JobRun } from '@/store/types';
import { RunSheet } from './content/RunSheet';

/** The Runs tab of Activity (the run history): every finished job with its cost, and the run log sheet. Prototype: vHistory() (1674-1681), openRun() (1967-1974). */
export function History() {
  const jobLog = useStore(s => s.jobLog);
  const siteFilter = useStore(s => s.siteFilter);
  const hasSites = useStore(s => s.sites.length > 0);
  const sample = useStore(s => s.sample);
  const [open, setOpen] = useState<JobRun | null>(null);

  const list = jobLog.filter(r => !r.site || inSite({ siteFilter }, r.site));
  const subscription = list.some(r => r.engine === 'codex-local');
  const tok = list.reduce((x, r) => x + r.tokens, 0), cost = list.reduce((x, r) => x + r.cost, 0);
  const shown = list.slice(0, 40);
  const failed = list.filter(r => r.status === 'Failed').length;
  /* The Site column already names the site, so the task drops the domain: "Building website v3". */
  const taskText = (r: JobRun): string => r.domain ? r.task.replace(r.domain + ' ', 'website ') : r.task;

  return (
    <>
      <p className="lede">Every job an agent has run, with its cost, duration and step-by-step log.</p>
      {jobLog.length ? (
        <Tiles>
          <Tile tone="a" value={list.length} label="Runs recorded" />
          <Tile tone="b" value={short(tok)} label="Tokens used" />
          <Tile tone="c" value={'$' + cost.toFixed(2)} label={subscription ? 'API/service spend' : sample ? 'Estimated cost' : 'Cost'} />
          <Tile tone={failed ? 'bad' : 'd'} value={failed} label="Failed runs" />
        </Tiles>
      ) : null}
      <section>
        <Table
          cols={['Time', 'Agent', 'Task', 'Site', 'Duration', 'Tokens', 'Cost', 'Status', 'Actions']}
          num={[0, 4, 5, 6]}
          empty={jobLog.length ? undefined : (
            <Empty icon="receipt_long" title="No runs yet"
              action={hasSites ? <Button variant="tonal" icon="add" onClick={() => go('keywords')}>New research request</Button> : <Button variant="tonal" icon="language" onClick={() => go('sites')}>Add your first domain</Button>}>
              Every job an agent finishes is listed here with its cost and log.
            </Empty>
          )}
          rowKey={(_, i) => shown[i]?.id ?? i}
          rows={shown.map(r => [
            stamp(r.t),
            <b>{r.agent}</b>,
            <span className="tcell">{taskText(r)}{r.by ? <span className="sub2">Asked by {r.by}</span> : null}</span>,
            <SiteChip id={r.site} domain={r.domain} />,
            fmtDur(r.dur),
            short(r.tokens),
            r.engine === 'codex-local' ? 'ChatGPT limits' : '$' + r.cost.toFixed(2),
            <Pill kind={r.status === 'Done' ? 'ok' : 'bad'}>{r.status}</Pill>,
            <Button size="sm" variant="text" onClick={() => setOpen(r)}>View log</Button>,
          ])}
        />
      </section>
      {jobLog.length ? <Info label="How costs are worked out"><p>{sample
        ? 'Costs are estimates from token counts and each model\'s standard list price, assuming three input tokens per output token, with no caching or batch discount.'
        : 'API costs are estimated from reported usage. Codex local uses ChatGPT limits; its subscription cost is not estimated.'}</p></Info> : null}
      <RunSheet run={open} onClose={() => setOpen(null)} />
    </>
  );
}
