import { useState } from 'react';
import { Button, Icon } from '@/components';
import { go } from '@/nav';
import { LIVE_KEY, queryClient, refreshEngine } from '@/store/live';
import { canSee, localRuntime, engineName, runtimeUsage } from '@/store/rules';
import { heldFor } from '@/store/spend';
import { useStore } from '@/store/store';
import { KwRequestSheet } from '../research/KwRequestSheet';
import { KwResultSheet } from '../research/KwResultSheet';
import { AddSiteSheet } from '../sites/AddSiteSheet';
import { ServiceSheet } from '../system/ServiceSheet';
import { openJourney } from '../journey/state';
import { nextStart, START_STEPS, startProgress, startSite } from './start';
import './start.css';

/** The workspace's first action stays in context; existing forms own validation, permissions and real submission. */
export function StartGuide() {
  const s = useStore();
  const [form, setForm] = useState<'connect' | 'site' | 'research' | null>(null);
  const [result, setResult] = useState<number | null>(null);
  if (s.sample || !s.session) return null;
  const local = localRuntime(s);
  const next = nextStart(s), site = startSite(s), progress = startProgress(s);
  const admin = s.session.role === 'admin', write = admin || s.session.role === 'editor';
  const waiting = !s.live.ready;
  const blocked = waiting || (next.action === 'connect' || next.action === 'team' ? !admin : !write && !['result', 'review', 'preview', 'sites'].includes(next.action));
  const held = site && next.state === 'working' ? heldFor(s, site.id) : null;
  const act = () => {
    if (blocked) return;
    if (next.action === 'connect' && local) {
      if (s.live.engine?.mode === 'codex-local') void refreshEngine();
      else go('integrations');
      return;
    }
    if (['connect', 'site', 'research'].includes(next.action)) {
      if (!s.guard()) return;
      if (next.action === 'connect' && !s.live.ints.openai) { go('integrations'); return; }
      if (next.action === 'research' && site) s.setSiteFilter(site.id);
      setForm(next.action as 'connect' | 'site' | 'research'); return;
    }
    if (site) s.setSiteFilter(site.id);
    if (next.action === 'result' && next.requestId != null) {
      if (next.state === 'working') openJourney({ kind: 'research', id: String(next.requestId) });
      else setResult(next.requestId);
    } else go(next.action === 'team' ? 'team' : next.action === 'sites' ? 'sites' : next.action === 'review' ? 'review' : 'website');
  };
  return <>
    <section className="start-guide" aria-labelledby="start-title" id="start-here">
      <header>
        <span className="start-label"><Icon name="route" />{next.state === 'complete' ? 'First website ready' : 'Start here'}</span>
        <h2 id="start-title">{site ? 'Your next step, in one place.' : 'Create your first article and website.'}</h2>
        <p>Meridian helps you find keyword ideas, write articles, review them and build a website. Start with one site and one topic.</p>
        {site ? <p className="start-site"><Icon name="language" /><b>{site.domain}</b><span>{site.country} · {site.lang}</span></p> : null}
      </header>
      <ol className="start-path" aria-label="From setup to your first website">
        {START_STEPS.map((label, i) => <li key={label} data-state={progress[i] ? 'done' : !waiting && i === next.step ? 'current' : 'later'} aria-current={!waiting && i === next.step ? 'step' : undefined}>
          <span className="start-number" aria-hidden="true">{progress[i] ? <Icon name="check" /> : i + 1}</span><span>{i === 0 && local ? 'Connect ' + engineName(s.live.engine?.mode) : label}<span className="sr-only">{progress[i] ? ' (done)' : i === next.step && !waiting ? ' (current step)' : ''}</span></span>
        </li>)}
      </ol>
      <div className="start-now" data-state={next.state}>
        <div><span className="start-label">{waiting ? 'Loading workspace status' : next.state === 'working' ? 'In progress' : next.state === 'failed' ? 'Needs attention' : next.state === 'complete' ? 'Ready for you' : `Step ${next.step + 1} of ${START_STEPS.length}`}</span>
          <h3>{waiting ? 'Checking your workspace…' : next.title}</h3>
          <p>{waiting ? 'The next action will appear when Meridian has loaded your connections and work.' : held || next.body}</p>
          {waiting && !s.live.on ? <><p>If this does not finish, check that the Meridian server is running and retry the connection.</p><Button variant="text" icon="refresh" onClick={() => { void queryClient.invalidateQueries({ queryKey: LIVE_KEY }); }}>Retry connection</Button></> : null}
          {!waiting && next.action === 'connect' && !local ? <p className="start-key-help">A ChatGPT subscription uses separate billing. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Create an OpenAI API key<Icon name="open_in_new" /></a></p> : null}
          {!waiting && blocked ? <p className="start-permission">{next.action === 'connect' ? local ? 'Ask an admin to configure the selected engine.' : 'Ask an admin to connect OpenAI. Your role cannot change API keys.' : next.action === 'team' ? 'Ask an admin to enable the Keyword agent.' : 'Your role can view work. Ask an admin or editor to start this step.'}</p> : null}
        </div>
        <Button variant="filled" icon={next.state === 'working' ? 'visibility' : 'arrow_forward'} disabled={blocked} onClick={act}>{waiting ? 'Loading…' : next.label}</Button>
      </div>
      <details className="start-later">
        <summary>What do I need now, and what can wait?<Icon name="expand_more" /></summary>
        <div><p><b>To start:</b> {local ? engineName(s.live.engine?.mode) + ' configured on this computer' : 'an OpenAI API key'}, a site domain, its country and language, and one research topic. The existing agents and model defaults are already configured.</p>
          {local ? <p>{runtimeUsage(s)}</p> : null}
          <p><b>Before publishing:</b> review the content, verify domain ownership and connect Cloudflare. You can preview a build and download it without Cloudflare. Build approval can queue publication when Cloudflare is connected.</p>
          <p><b>When you need them:</b> Search Console and Analytics measure a live site's performance; DataForSEO adds search-volume data; email and messaging deliver alerts. These do not block the first research.</p>
          <div className="row">{canSee(s.session, 'settings') ? <Button variant="text" onClick={() => go('settings')}>Review approval settings</Button> : null}{admin ? <Button variant="text" onClick={() => go('integrations')}>All integrations</Button> : null}</div>
        </div>
      </details>
    </section>
    <ServiceSheet id={form === 'connect' ? 'openai' : null} onClose={() => setForm(null)} />
    <AddSiteSheet open={form === 'site'} onClose={() => setForm(null)} />
    <KwRequestSheet open={form === 'research'} onClose={() => setForm(null)} />
    <KwResultSheet rid={result} onClose={() => setResult(null)} />
  </>;
}
