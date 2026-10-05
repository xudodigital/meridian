import { useState } from 'react';
import { SEO_TASKS, type SeoTaskKind, type SeoTaskWire } from '../../../../shared/seo-tasks';
import { Button, Callout, Empty, Field, Fields, Info, Pill, Select } from '@/components';
import { codexLocal, runtimeModel } from '@/store/rules';
import { apiGet, apiSend } from '@/store/serverApi';
import { useStore } from '@/store/store';
import { go } from '@/nav';
import './seo-tasks.css';

const placeholders: Record<SeoTaskKind, string> = {
  strategy: 'Audience, site goal and original expertise or data you can contribute.',
  serp: 'One search query, for example: cara menyeduh kopi',
  architecture: 'Which topics should the site cover? Describe its main audience and useful categories.',
  audit: 'Which article, claim or SEO issue should be checked? Mention any sensitive health, finance or legal advice.',
  links: 'Which topic or orphan article needs relevant internal links?',
  analysis: 'What changed, and which outcome matters? For example: explain pages losing clicks and propose a follow-up measure.',
  refresh: 'Which pages may be outdated? Describe the intended improvement and any sources or first-hand evidence you can provide.',
  visual: 'Which article or process should become an infographic? Include what the reader should learn.',
  pr: 'Describe a useful original asset and the audience or publication it could help. No outreach is sent from this task.',
};
export function SeoTasks({ initialKind = 'strategy' }: { initialKind?: SeoTaskKind }) {
  const sites = useStore(s => s.sites), filter = useStore(s => s.siteFilter);
  const live = useStore(s => s.live), sample = useStore(s => s.sample);
  const [chosen, setChosen] = useState('');
  const [kind, setKind] = useState<SeoTaskKind>(initialKind), [brief, setBrief] = useState('');
  const [liveAudit, setLiveAudit] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const siteId = chosen && sites.some(s => s.id === chosen) ? chosen : filter !== 'all' && sites.some(s => s.id === filter) ? filter : sites[0]?.id ?? '';
  const selected = sites.find(s => s.id === siteId);
  const tasks = Object.values(live.seoTasks ?? {}).filter(t => t.siteId === siteId).sort((a, b) => b.id - a.id);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(tasks.length / 8) - 1));
  const selectedAgent = useStore(s => s.agents.find(a => a.id === SEO_TASKS[kind].agent));
  const writable = useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');
  const needs = SEO_TASKS[kind].needsArticles;
  const hasArticles = Object.values(live.arts).some(a => a.siteId === siteId && a.domain === selected?.domain && (a.status === 'review' || a.status === 'approved'));
  const local = codexLocal({live});
  const ready = live.on && live.engine?.ready && !sample;
  const duplicate = tasks.some(t => t.kind === kind && (t.status === 'queued' || t.status === 'work'));
  const receive = (task: SeoTaskWire) => useStore.setState(d => { d.live.seoTasks ??= {}; d.live.seoTasks[task.id] = task; });
  const run = async () => {
    if (!useStore.getState().guard()) return;
    setBusy(true); setError('');
    try { receive((await apiSend<{ task: SeoTaskWire }>('/api/seo-tasks', { siteId, kind, brief, liveAudit, model: selectedAgent?.model })).task); setBrief(''); setPage(0); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const review = async (id: number) => {
    if (!useStore.getState().guard()) return;
    setBusy(true); setError('');
    try { receive((await apiSend<{ task: SeoTaskWire }>(`/api/seo-tasks/${id}/review`)).task); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="seo-workbench">
    <div className="sh"><h2>Plan, check and improve your site</h2><Pill kind="info">Drafts for human review</Pill></div>
    <p>Start with strategy, then research, audit and improve.</p>
    {!sites.length ? <Empty icon="language" title="Add your first site" action={<Button onClick={() => go('sites')}>Open Sites</Button>}>Every task uses a saved site's country, language and content.</Empty> : <>
      <Fields>
        <Field label="1. Choose a site"><Select label="Task site" value={siteId} onChange={v => { setChosen(v); setPage(0); }} options={sites.map(s => ({ value: s.id, label: s.domain }))} /></Field>
        <Field label="2. Choose what you need"><Select label="SEO task" value={kind} onChange={v => { setKind(v as SeoTaskKind); setBrief(''); setError(''); }} options={Object.entries(SEO_TASKS).map(([value, s]) => ({ value, label: s.title }))} /></Field>
        <Field label="3. Describe your goal" wide><textarea aria-label="Task brief" rows={4} maxLength={kind === 'serp' ? 150 : 3000} value={brief} onChange={e => setBrief(e.target.value)} placeholder={placeholders[kind]} /></Field>
      </Fields>
      <p className="note">{selectedAgent?.name ?? SEO_TASKS[kind].agent} · {runtimeModel({live}, selectedAgent?.model || 'not configured')} · {selected?.country} · {selected?.lang}. {local ? 'Uses ChatGPT usage limits.' : 'Uses the site budget.'}{kind === 'serp' ? ' Also uses DataForSEO credits.' : ''}</p>
      {kind === 'audit' ? <label className="seo-live-choice"><input type="checkbox" checked={liveAudit} onChange={e => setLiveAudit(e.target.checked)} /> Also inspect public pages, robots.txt and sitemap.xml (up to 10 URLs)</label> : null}
      {needs && !hasArticles ? <Callout icon="article" info>This task needs an article in review or approved. <Button variant="text" onClick={() => go('review')}>Open article review</Button></Callout> : null}
      {!ready ? <Callout icon="key" info>{local ? live.engine?.reason || 'Sign in to Codex on this computer to run a task.' : 'Connect and test OpenAI in Integrations to run a task.'} <Button variant="text" onClick={() => go('integrations')}>Open Integrations</Button></Callout> : null}
      {error ? <p className="seo-error" role="alert">{error}</p> : null}
      <Button variant="filled" icon="play_arrow" disabled={!writable || !ready || busy || !brief.trim() || duplicate || (needs && !hasArticles)} onClick={() => void run()}>{busy ? 'Working…' : duplicate ? 'This task is already queued' : 'Run this task'}</Button>
      <Info label="Review and next steps"><p>Marking a result reviewed does not apply article edits or send outreach. A reviewed strategy guides later articles. Apply other proposals in the article or category editor, then review and rebuild.</p></Info>
    </>}
    <h3>Results for {selected?.domain ?? 'your site'}</h3>
    {tasks.length ? tasks.slice(currentPage * 8, currentPage * 8 + 8).map(t => <TaskResult key={t.id} task={t} onReview={() => void review(t.id)} disabled={busy || !writable} />) : <Empty icon="task">No tasks yet. Choose a goal above to get a focused result.</Empty>}
    {tasks.length > 8 ? <div className="row"><Button variant="text" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span>{currentPage + 1} of {Math.ceil(tasks.length / 8)}</span><Button variant="text" disabled={(currentPage + 1) * 8 >= tasks.length} onClick={() => setPage(currentPage + 1)}>Next</Button></div> : null}
  </section>;
}
function TaskResult({ task: t, onReview, disabled }: { task: SeoTaskWire; onReview: () => void; disabled: boolean }) {
  const r = t.result;
  const [evidence, setEvidence] = useState(''), [evidenceError, setEvidenceError] = useState('');
  const loadEvidence = async () => { try { setEvidence((await apiGet<{ task: SeoTaskWire }>(`/api/seo-tasks/${t.id}`)).task.context); } catch (e) { setEvidenceError((e as Error).message); } };
  return <details className="seo-task-result"><summary><span><b>{SEO_TASKS[t.kind].title}</b> · {new Date(t.createdAt).toLocaleString()}<span className="note seo-task-brief">{t.brief}</span></span><Pill kind={t.status === 'failed' ? 'bad' : t.status === 'done' ? 'ok' : 'info'}>{t.reviewedAt ? 'Reviewed' : t.status === 'done' ? 'Ready to review' : t.status}</Pill></summary>
    {t.error ? <p role="alert" className="seo-error">{t.error}</p> : null}
    {r ? <div className="seo-result-body">
      <p>{r.summary}</p><p className="note">Verify findings against the saved evidence.</p>
      <h4>Findings</h4>{r.findings.map((f, i) => <article key={i}><b>{f.title}</b> <span className="note">{f.basis}</span><p>{f.detail}</p></article>)}
      <h4>Next actions</h4>{r.actions.map((a, i) => <article key={i}><b>{a.title}</b> · {a.priority} · {a.owner}<p>{a.detail}</p></article>)}
      {r.links.length ? <><h4>Contextual links to review in the article editor</h4><ul>{r.links.map((l, i) => <li key={i}>Article #{l.from} → #{l.to}: “{l.anchor}”. {l.reason}</li>)}</ul><Button variant="tonal" onClick={() => go('review')}>Open article review</Button></> : null}
      {r.visual ? <><h4>{r.visual.title}</h4><p>{r.visual.alt}</p><ol>{r.visual.steps.map((s, i) => <li key={i}><b>{s.label}</b> — {s.detail}</li>)}</ol><a className="btn tonal" href={`/api/seo-tasks/${t.id}/svg`} download>Download infographic draft (SVG)</a></> : null}
      <h4>Limitations and claims to verify</h4><ul>{r.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {r.sources.length ? <><h4>Sources to check</h4><ul>{r.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul></> : null}
      <details><summary>Saved evidence and data coverage</summary><Button variant="text" onClick={() => void loadEvidence()}>Load saved evidence</Button>{evidenceError ? <p role="alert">{evidenceError}</p> : null}{evidence ? <pre className="seo-context">{evidence}</pre> : null}</details>
      <p className="note">{t.tokens.toLocaleString()} tokens · {t.engine === 'codex-local' ? 'Codex local · API cost not estimated' : `OpenAI estimate $${t.costUsd.toFixed(4)}`} · DataForSEO ${t.serviceCostUsd.toFixed(4)}</p>
      {t.reviewedAt ? <p>Reviewed by {t.reviewedBy}. Article changes still need their own review and build.</p> : <Button variant="tonal" disabled={disabled} onClick={onReview}>I have reviewed this draft</Button>}
    </div> : <p role="status">{t.status === 'queued' ? 'Waiting in the shared job queue.' : t.status === 'work' ? 'The agent is preparing a result. You can leave this page.' : 'No result saved. Create a new task with a revised brief.'}</p>}
  </details>;
}
