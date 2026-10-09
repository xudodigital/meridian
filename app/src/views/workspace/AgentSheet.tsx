import { AgentAvatar } from '@/components/AgentAvatar';
import { useEffect, useState } from 'react';
import { Button, Chip, Pill, Sheet, SheetActions, Tag } from '@/components';
import { go } from '@/nav';
import { apiGet } from '@/store/serverApi';
import { runtimeModel, engineName, showCosts, agentPlanned, fmt, fmtDur, stamp } from '@/store/rules';
import { useStore, useStoreShallow } from '@/store/store';
import type { Agent, Skill } from '@/store/types';
import { agentLook, workersText } from './helpers';

/** The contents of the agent sheet (the prototype's openAgent): status, current task, skills, prompt, activity and runs. */
function AgentDetail({ a }: { a: Agent }) {
  const [skills, log, jobLog, guard, closeAgent, retryAgent, pauseAgent, openConfirm, sample] = useStoreShallow(s =>
    [s.skills, s.log, s.jobLog, s.guard, s.closeAgent, s.retryAgent, s.pauseAgent, s.openConfirm, s.sample] as const);
  const costs = useStore(showCosts);
  const live = useStore(s => s.live);
  const look = agentLook(a);
  const sk = a.skills.map(i => skills.find(k => k.id === i)).filter((k): k is Skill => !!k);
  const rec = log.filter(l => l.actor === a.name).slice(0, 5);
  const runs = jobLog.filter(r => r.agent === a.name).slice(0, 3);
  const off = a.status === 'off';
  const planned = agentPlanned({ sample }, a);
  /* Removing asks first (the confirm dialog); the sheet closes so the dialog is not stacked on it. */
  const remove = () => { if (!guard()) return; closeAgent(); openConfirm(`ag:${a.id}`); };
  /* Pause and Retry close the sheet first, as in the prototype (after the role check). */
  const fromSheet = (fn: (id: string) => void) => () => { if (!guard()) return; closeAgent(); fn(a.id); };
  return (
    <>
      <div className={'card desk h' + a.hue} style={{ padding: 16 }}>
        <header>
          <span className={'ava agent-portrait h' + a.hue} aria-hidden="true"><AgentAvatar a={a} state={look.st} portrait /></span>
          <div className="who"><h3 id="sheetT">{a.name}</h3><p>{a.role}</p></div>
          {planned ? <Pill kind="mut">Planned</Pill> : <Pill kind={look.kind} live={look.pulse}>{look.label}</Pill>}
        </header>
      </div>
      <div className="dsec">
        <h3>Now</h3>
        <p style={{ margin: 0 }}>{planned ? 'Planned: Meridian has no job for this agent yet, so it does not run.' : look.task}</p>
        {look.step && !planned ? <p className="note" style={{ margin: 0 }}>{look.step}</p> : null}
        <div className="tags">
          {['orc', 'dep'].includes(a.id) && !sample ? <Tag icon="code">No model: runs as code</Tag> : <Tag icon="memory">{runtimeModel({live}, a.model)}</Tag>}
          {sample || a.tokens > 0 ? <Tag icon="toll">{fmt(a.tokens)} tokens today</Tag> : null}
          {sample ? <Tag icon="groups">{workersText(a.workers)}</Tag> : null}
        </div>
      </div>
      <div className="dsec">
        <h3>Skills</h3>
        <div className="tags">{sk.length ? sk.map(k => <Tag key={k.id} icon="psychology">{k.name}</Tag>) : <span className="note">No skills attached. Attach them in Models and skills.</span>}</div>
      </div>
      <div className="dsec">
        <h3>System prompt</h3>
        <SystemPrompt a={a} skills={sk} />
      </div>
      <div className="dsec">
        <h3>Recent activity</h3>
        <ul>{rec.length ? rec.map((l, i) => <li key={i}><Chip>{stamp(l.t)}</Chip> {l.act}</li>) : <li className="note">Nothing logged yet.</li>}</ul>
      </div>
      <div className="dsec">
        <h3>Recent runs</h3>
        <ul>
          {runs.length ? runs.map(r => (
            <li key={r.id}><Chip>{stamp(r.t)}</Chip>{` ${r.task} · ${fmtDur(r.dur)} · ${!costs || r.engine === 'gemma-local' || r.engine === 'codex-local' ? engineName(r.engine) : '$' + r.cost.toFixed(2)} `}<Pill kind={r.status === 'Done' ? 'ok' : 'bad'}>{r.status}</Pill></li>
          )) : <li className="note">No finished runs yet.</li>}
        </ul>
      </div>
      {!sample && ['res', 'arc', 'seo', 'lnk', 'ana', 'gd'].includes(a.id) ? <Button variant="tonal" icon="task" onClick={() => { useStore.getState().setRctab('research'); go('research'); }}>Open SEO tasks</Button> : null}
      <SheetActions>
        {a.status === 'err' ? <Button variant="tonal" icon="refresh" onClick={fromSheet(retryAgent)}>Retry</Button> : null}
        {/* Outside demo mode pausing does not stop a server job, so only Resume (for an agent paused earlier) is offered. */}
        {sample || off ? <Button variant="tonal" icon={off ? 'play_arrow' : 'pause'} onClick={fromSheet(pauseAgent)}>{off ? 'Resume' : 'Pause'}</Button> : null}
        <Button variant="danger" icon="delete" aria-label={'Remove ' + a.name} onClick={remove}>Remove</Button>
        <span className="grow" />
        {planned ? null : <Button variant="text" onClick={() => go('history')}>See all runs</Button>}
        <Button variant="text" onClick={closeAgent}>Close</Button>
      </SheetActions>
    </>
  );
}

/** The agents the server runs jobs for, and the key of their prompt template in GET /api/agents/prompts. */
const RUNNERS: Readonly<Record<string, 'kw' | 'wr'>> = { kw: 'kw', wr: 'wr' };
/** What the server's other agents do, for the agents whose jobs have no single prompt template to show. */
const JOBS: Readonly<Record<string, string>> = {
  orc: 'This agent uses no prompt and no model. It is Meridian\'s workflow engine: code that queues the other agents\' jobs in order (keyword research, articles, the website build, the deploy) and waits for your review and approval in between. See Build and deploy, Workflows tab.',
  bld: 'Meridian runs this agent for two jobs: choosing openly licensed photos for each article that is written, and building the website from approved articles. Each job builds its prompt from that article or site.',
  res: 'Research runs editorial strategy, DataForSEO SERP snapshots and Digital PR drafts in Research and SEO. Results wait for human review; outreach is never sent.',
  arc: 'Architect proposes categories, URLs, topic hierarchy and navigation from the saved site and its articles. Apply the reviewed proposal with the category and article editors.',
  seo: 'SEO/GEO runs content audits and maintenance proposals. Optional public-page observations cover up to 10 URLs; they do not measure indexing or Core Web Vitals.',
  lnk: 'Internal Linker proposes contextual links between saved articles. Anchors and targets are validated by the server; apply proposals in the article editor and review the article.',
  ana: 'Analyst interprets the saved Search Console and GA4 snapshots, showing their date range and limitations. Connect and refresh at least one source first.',
  gd: 'Graphic Designer creates process infographic drafts from article evidence. The server renders safe SVG with alternative text; review it before use.',
  dep: 'This agent uses no prompt. Meridian puts approved website builds live on Cloudflare Pages and checks whether each site can be reached from its country.',
};
type Prompts = { kw: string; wr: string };
let prompts: Promise<Prompts> | null = null;
const loadPrompts = () => (prompts ??= apiGet<{ prompts: Prompts }>('/api/agents/prompts').then(r => r.prompts, e => { prompts = null; throw e; }));

/**
 * What the agent is told. For the Keyword agent and the Content Writer it is the real prompt template the server runs
 * jobs with (placeholders such as {keyword} are filled per job). The Site Builder and Deploy & Monitor say what their
 * jobs are. The other agents have no job runner yet, so they have no prompt; their skills are listed instead. Demo
 * mode shows the sample's generic prompt.
 */
function SystemPrompt({ a, skills }: { a: Agent; skills: Skill[] }) {
  const sample = useStore(s => s.sample);
  const key = RUNNERS[a.id];
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (sample || !key) return;
    let live = true;
    loadPrompts().then(p => { if (live) setText(p[key]); }, () => { if (live) setErr('The prompt is shown while the Meridian server is running.'); });
    return () => { live = false; };
  }, [sample, key]);
  if (sample) {
    return <div className="sysprompt">{`You are the ${a.name} agent. Role: ${a.role.toLowerCase()}.
Work only on the site named in the job, using that site's profile, language and credentials.
Stop and ask for approval before anything is published or deployed.`}</div>;
  }
  if (!key && JOBS[a.id]) return <p className="note">{JOBS[a.id]}</p>;
  if (!key) {
    return (
      <p className="note">
        This agent has no job runner yet, so Meridian never sends it a prompt. {skills.length
          ? 'When it gets one, it works from these skills: ' + skills.map(k => k.name).join(', ') + '.'
          : 'It has no skills attached either.'}
      </p>
    );
  }
  return (
    <>
      <div className="sysprompt">{text ?? (err || 'Loading the prompt…')}</div>
      {text ? <p className="note">The prompt template the server runs every job with. Words in braces, such as {'{keyword}'}, are filled in for each job.</p> : null}
    </>
  );
}

/** The agent detail sheet. It is open while store.agentSheet names an agent: from a card, a station or global search. */
export function AgentSheet() {
  const id = useStore(s => s.agentSheet);
  const a = useStore(s => s.agents.find(x => x.id === id));
  const closeAgent = useStore(s => s.closeAgent);
  return (
    <Sheet open={!!a} onClose={closeAgent} labelledBy="sheetT">
      {a ? <AgentDetail a={a} /> : null}
    </Sheet>
  );
}
