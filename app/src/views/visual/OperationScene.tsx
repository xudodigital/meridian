import { useId, useState, type CSSProperties } from 'react';
import { Button, Icon } from '@/components';
import { useStoreShallow } from '@/store/store';
import { sceneModel, type SceneKind, type SceneStage } from './model';
import { openJourney } from '../journey/state';
import './visual.css';

/** CSS miniatures communicate a station's purpose; the text is always the source of truth. */
function Miniature({ stage, network }: { stage: SceneStage; network: boolean }) {
  return <span className={'vs-mini' + (network ? ' vs-network' : '')} aria-hidden="true">
    <span className="vs-platform" />
    <span className="vs-screen"><span className="vs-screen-bar"><i /><i /><i /></span><Icon name={stage.icon} /><span className="vs-screen-lines"><i /><i /></span></span>
    <span className="vs-paper"><i /><i /><i /></span>
    <span className="vs-person"><i /><b /></span>
    <span className="vs-marker"><Icon name={stage.tone === 'success' ? 'check' : stage.tone === 'waiting' ? 'front_hand' : stage.tone === 'error' ? 'priority_high' : stage.icon} /></span>
  </span>;
}

export function OperationScene({ kind }: { kind: SceneKind }) {
  const [sites, siteFilter, session, articles, kwReqs, live, sample, deploys, approvals] = useStoreShallow(s =>
    [s.sites, s.siteFilter, s.session, s.articles, s.kwReqs, s.live, s.sample, s.deploys, s.approvals] as const);
  const model = sceneModel(kind, { sites, siteFilter, session, articles, kwReqs, live, sample, deploys, approvals });
  return <Scene key={`${kind}:${siteFilter}:${session?.id}`} model={model} kind={kind} sample={sample} ready={live.ready} />;
}

function Scene({ model, kind, sample, ready }: { model: ReturnType<typeof sceneModel>; kind: SceneKind; sample: boolean; ready: boolean }) {
  const id = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const total = model.stages.reduce((sum, stage) => sum + stage.records.length, 0);
  const active = model.stages.find(s => s.id === selected) ?? model.stages.find(s => s.records.some(r => r.working))
    ?? model.stages.find(s => s.tone === 'waiting' && s.records.length) ?? model.stages.find(s => s.records.length) ?? model.stages[0];
  const moving = model.stages.some(s => s.records.some(r => r.working));
  const pageCount = Math.max(1, Math.ceil(active.records.length / 3));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = active.records.slice(currentPage * 3, currentPage * 3 + 3);
  return (
    <section className="vs" aria-labelledby={`${id}-title`} data-kind={kind}>
      <div className="vs-heading">
        <div><div className="vs-eyebrow"><span className="vs-status-dot" data-working={moving} />{sample ? 'Demo workspace' : ready ? 'Workspace snapshot' : 'Waiting for server data'}</div>
          <h2 id={`${id}-title`}>{model.title}</h2><p>{model.description}</p></div>
        <div className="vs-heading-end"><div className="vs-total"><b>{sample || ready ? total : '—'}</b><span>{model.unit}<small>in this view</small></span></div><button type="button" className="ib vs-toggle" aria-label={collapsed ? "Show visual overview" : "Hide visual overview"} aria-expanded={!collapsed} aria-controls={`${id}-overview`} onClick={() => setCollapsed(!collapsed)}><Icon name={collapsed ? "expand_more" : "expand_less"} /></button></div>
      </div>
      <div id={`${id}-overview`} hidden={collapsed}><div className="vs-stations" style={{ '--stations': model.stages.length } as CSSProperties}>
        {model.stages.map((stage, i) => <button type="button" key={stage.id} className="vs-station" data-tone={stage.tone}
          data-working={stage.records.some(r => r.working)} aria-pressed={selected === stage.id} aria-expanded={selected === stage.id} aria-controls={`${id}-detail`}
          onClick={() => { setSelected(selected === stage.id ? null : stage.id); setPage(0); }}>
          <span className="vs-station-top"><span className="vs-index">{String(i + 1).padStart(2, '0')}</span><span className="vs-count">{sample || ready ? stage.records.length : '—'}</span></span>
          <Miniature stage={stage} network={kind === 'sites'} />
          <span className="vs-station-name">{stage.label}<Icon name="arrow_forward" /></span>
          <span className="vs-station-status">{stage.records.some(r => r.working) ? 'Working now' : stage.records.length ? 'Select to explore' : 'Nothing here yet'}</span>
        </button>)}
      </div>
      <div className="vs-inspector" id={`${id}-detail`} hidden={selected === null}>
        {selected !== null ? <><div className="vs-inspector-heading"><span className="vs-detail-icon" data-tone={active.tone}><Icon name={active.icon} /></span><div><h3>{active.label}</h3><p>{active.hint}</p></div></div>
        {rows.length ? <ul className="vs-records">{rows.map(r => <li key={r.id}><span className="vs-record-dot" data-working={!!r.working} /><div><button type="button" className="vs-record-link" onClick={() => openJourney({kind, id:r.id})}>{r.title}<Icon name="arrow_outward" /></button><span>{r.detail}</span></div>{r.working ? <span className="vs-working">Working</span> : null}</li>)}</ul>
          : <p className="vs-empty">{sample || ready ? `No ${model.unit} in this station. Your next steps appear below.` : 'The visual will fill in after Meridian loads the server state.'}</p>}
        {active.records.length > 0 ? <nav className="vs-pagination" aria-label={`${active.label} records`}>
          <span role="status">{currentPage * 3 + 1}–{Math.min((currentPage + 1) * 3, active.records.length)} of {active.records.length}</span>
          {pageCount > 1 ? <><Button variant="text" size="sm" icon="chevron_left" aria-label="Previous records" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button variant="text" size="sm" icon="chevron_right" aria-label="Next records" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button></> : null}
        </nav> : null}
      </> : null}</div>
      <div className="vs-foot"><span><Icon name="touch_app" />Select a station to inspect its records</span><span>{sample ? 'Example data' : 'Counts follow the site filter'} · Motion shows running work</span></div>
      </div>
    </section>
  );
}
