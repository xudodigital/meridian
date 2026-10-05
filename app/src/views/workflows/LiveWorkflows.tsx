/* The Workflows tab outside demo mode: the workflows running now with their steps, the recent ones, the schedules, and
   what "Weekly content" does. Everything shown is the server's (server/workflows.ts); admins and editors start, cancel
   and schedule, a viewer only looks. */
import { useState } from 'react';
import { Button, Callout, Empty, Info, ModTable } from '@/components';
import { go } from '@/nav';
import { FLOW, runsShown } from '@/store/liveWorkflows';
import { engineReady, codexLocal } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import { mayWrite } from '../deploy/parts';
import { RunCard } from './RunCard';
import { RunSheet } from './RunSheet';
import { ScheduleSheet } from './ScheduleSheet';
import { SchedulesSection } from './SchedulesSection';
import './workflows.css';

/** How many ended runs are listed. */
const RECENT = 6;

export function LiveWorkflows() {
  const runs = useStoreShallow(s => runsShown(s));
  const write = useStore(mayWrite);
  const local = useStore(codexLocal);
  const reason = useStore(s => s.live.engine?.reason);
  const engine = useStore(s => engineReady(s));
  const liveOn = useStore(s => s.live.on);
  const [hasSites, country] = useStoreShallow(s => [s.sites.length > 0, s.sites[0]?.country] as const);
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const running = runs.filter(r => r.status === 'running'), recent = runs.filter(r => r.status !== 'running').slice(0, RECENT);
  const can = write && hasSites;
  return (
    <>
      <p className="lede">Run a content workflow. Review articles and approve the website before publishing.</p>
      {liveOn && !engine ? (
        <Callout icon="info" warn>{local ? <><b>Codex local is not ready.</b> {reason || 'Sign in to Codex on this computer and check its status in Integrations.'}</> : <><b>OpenAI is not connected, so no workflow can start.</b> Add and test your API key in Integrations. A schedule whose time comes meanwhile is not started, and says so.</>}</Callout>
      ) : null}
      <section>
        <div className="sh">
          <h2>Running now</h2>
          {can ? <Button variant="filled" icon="play_arrow" onClick={() => setStarting(true)}>Run workflow</Button> : null}
        </div>
        {running.length ? <div className="wf-list">{running.map(r => <RunCard key={r.id} run={r} />)}</div> : (
          <Empty icon="account_tree" title="No workflow is running"
            action={hasSites ? undefined : <Button variant="tonal" icon="language" onClick={() => go('sites')}>Add your first domain</Button>}>
            {hasSites
              ? 'Run Weekly content for a site, or add a schedule. A run is shown here from its first step to its last, with what it is waiting for.'
              : 'A workflow runs for one site. Add a site first.'}
          </Empty>
        )}
      </section>
      {recent.length ? (
        <section>
          <h2>Recent runs</h2>
          <div className="wf-list">{recent.map(r => <RunCard key={r.id} run={r} />)}</div>
        </section>
      ) : null}
      <section>
        <div className="sh">
          <h2>Schedules</h2>
          {can ? <Button variant="tonal" icon="add" onClick={() => setAdding(true)}>New schedule</Button> : null}
        </div>
        <SchedulesSection />
        <Info label="About schedule times">
          <p>Times are on each site's own clock{country ? `, so "Monday 06:00" for a site in ${country} is Monday morning in ${country}` : ''}. Meridian looks at the schedules every minute while it is running. If it was not running at a schedule's time it starts the run when it is back, unless that is more than 6 hours late: then the run is skipped and the schedule says so. A site never has two workflows running at once. The weekly report has its own schedule in Reports.</p>
        </Info>
      </section>
      <section>
        <h2>What Weekly content does</h2>
        <ol className="wf-explain">
          {FLOW.map(f => <li key={f.id}><b>{f.label}.</b> {WHAT[f.id]}</li>)}
        </ol>
        <p className="note">Agent jobs use the site budget. The Orchestrator itself makes no model calls.</p>
      </section>
      <section>
        <h2>Site builds</h2>
        <ModTable id="factory" action={<Button variant="tonal" icon="rocket_launch" onClick={() => go('website')}>Open the Website tab</Button>} />
      </section>
      <RunSheet open={starting} onClose={() => setStarting(false)} />
      <ScheduleSheet edit={adding ? 'new' : null} onClose={() => setAdding(false)} />
    </>
  );
}

const WHAT: Readonly<Record<string, string>> = {
  research: 'The Keyword agent researches the site\'s topic (or the topic you give the run).',
  write: 'The Content Writer writes an article for each of the best keywords that have no article yet: 1 to 5 per run, by search volume when volumes are known, else in the Keyword agent\'s order.',
  review: 'The run waits until you have approved or rejected every article in Article review.',
  build: 'When at least one article is approved, the Site Builder builds the website again.',
  approve: 'The run waits for your approval of the build (unless Settings say deploys need no approval).',
  deploy: 'Deploy & Monitor puts the approved build live on Cloudflare Pages. Without Cloudflare the run ends at the approved build, which you can download as a ZIP.',
};
