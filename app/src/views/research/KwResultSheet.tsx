import { useState } from 'react';
import { Button, Callout, Checkbox, Field, Select, Info, Pill, Sheet, SheetActions, Table, Tag } from '@/components';
import { insightsApi } from '@/store/insightsApi';
import { retryRequest } from '@/store/live';
import { volumeText } from '@/store/liveApply';
import { usableInt } from '@/store/serverFacts';
import { REQ_ST, articleQueued, fmt, fmtDur, dayTime, siteById } from '@/store/rules';
import { useStore } from '@/store/store';
import type { KwRequest } from '@/store/types';
import { VOLUME_PROVIDERS } from '../../../../shared/volumes';
import { WriteArticleSheet, type ArticleTarget } from './WriteArticleSheet';
import '../content/review.css';

/** Google Ads competition as the table shows it. */
const COMPETITION: Readonly<Record<string, string>> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

/** How many articles one "Write selected" asks for at most (the server's limit, server/article-api.ts BULK_MAX). */
export const BULK_MAX = 10;

/**
 * The prototype's openKwResult(): summary, keywords and notes of a finished live request, or its error. Each keyword
 * can be sent to the Content Writer ("Write article"), or several at once: tick them and choose "Write selected".
 */
export function KwResultSheet({ rid, onClose }: { rid: number | null; onClose: () => void }) {
  const r = useStore(s => rid == null ? undefined : s.kwReqs.find(x => x.rid === rid));
  return (
    <Sheet open={!!r} onClose={onClose} title={r?.topic} size="wide">
      {r ? <KwResult r={r} onClose={onClose} /> : null}
    </Sheet>
  );
}

function KwResult({ r, onClose }: { r: KwRequest; onClose: () => void }) {
  const site = useStore(s => siteById(s, r.site));
  const articles = useStore(s => s.articles);
  const mayWrite = useStore(s => s.session?.role === 'admin' || s.session?.role === 'editor');
  const [target, setTarget] = useState<ArticleTarget | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [kind, label] = REQ_ST[r.st];
  /* Opening the confirm sheet is a change action: refused for viewers. */
  const write = (keywords: string[]) => { if (useStore.getState().guard()) setTarget({ r, keyword: keywords[0] ?? '', keywords }); };

  /* "Run again" (kw-retry): closes the sheet once the server queued the request again. */
  const again = async () => {
    if (r.rid == null || !useStore.getState().guard()) return;
    if (await retryRequest(r.rid)) onClose();
  };

  const keywords = r.keywords || [];
  /* Search volume (DataForSEO): the columns show once any keyword of this result was asked for; "Refresh volumes"
     shows when the service is connected. Competition is among advertisers, as Google Ads reports it. */
  const dfs = useStore(s => usableInt(s, 'dfs'));
  const ads = useStore(s => usableInt(s, 'ads'));
  const [volumeProvider, setVolumeProvider] = useState<'ads' | 'dfs'>(ads ? 'ads' : 'dfs');
  const selectedProvider = volumeProvider === 'ads' && ads ? 'ads' : volumeProvider === 'dfs' && dfs ? 'dfs' : ads ? 'ads' : 'dfs';
  const withVolume = keywords.some(k => !!k.volumeAt);
  const [volBusy, setVolBusy] = useState(false);
  const refreshVolumes = async () => {
    if (r.rid == null || !useStore.getState().guard()) return;
    setVolBusy(true);
    try {
      const d = await insightsApi.volumes(r.rid, selectedProvider);
      useStore.getState().snack(d.found ? `Search volume refreshed: ${d.found} of ${d.sent} keywords have a figure.` : 'No search volume is available for these keywords.', 'query_stats');
    } catch (e) { useStore.getState().snack((e as Error).message, 'error'); }
    finally { setVolBusy(false); }
  };
  /* "Track": the keyword's position is followed in Analytics > Rank (approved articles are tracked by themselves). */
  const track = async (id: number, on: boolean) => {
    if (!useStore.getState().guard()) return;
    try { await insightsApi.track(id, on); } catch (e) { useStore.getState().snack((e as Error).message, 'error'); }
  };
  const canTrack = mayWrite && keywords.some(k => k.id != null);
  /* A keyword whose article is already on its way cannot be asked for again (the server refuses it too). */
  const busy = (k: string) => articleQueued({ articles }, r.site, k);
  const free = keywords.filter(k => !busy(k.keyword)).map(k => k.keyword);
  const chosen = free.filter(k => picked.includes(k));
  const toggle = (k: string) => setPicked(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);
  const bulk = mayWrite && r.rid != null && keywords.length > 1;

  return (
    <>
      <div className="tags" style={{ marginTop: 12 }}>
        {site || r.domain ? <Tag icon="language">{site ? site.domain : r.domain}</Tag> : null}
        {r.by ? <Tag icon="person">Asked by {r.by}</Tag> : null}
        {r.engine === 'gemma-local' ? <Tag icon="smart_toy">Gemma localhost</Tag> : r.engine === 'codex-local' ? <Tag icon="smart_toy">Codex local</Tag> : r.engine === 'openai-api' ? <Tag icon="smart_toy">OpenAI</Tag> : null}
        {r.dur ? <Tag icon="timer">{fmtDur(r.dur)}</Tag> : null}
        {r.tokens ? <Tag icon="toll">{fmt(r.tokens)} tokens</Tag> : null}
        <Pill kind={kind}>{label}</Pill>
      </div>
      {r.st === 'failed' ? <Callout icon="error" warn>{r.error}</Callout> : (
        <>
          <p>{r.summary}</p>
          <Table
            responsive="container"
            cols={[...(bulk ? [{ label: 'Select', head: <span className="sr-only">Select</span> }] : []), 'Keyword', 'Meaning', ...(withVolume ? ['Volume/mo', 'Competition'] : []), 'Intent', 'Cluster', 'Why proposed', ...(canTrack ? ['Track'] : []), 'Actions']}
            num={withVolume ? [bulk ? 3 : 2] : []}
            rowKey={(_, i) => keywords[i]!.keyword}
            rows={keywords.map(k => [
              ...(bulk ? [busy(k.keyword)
                ? <span key="c" className="ck" title="An article for this keyword is already queued, being written or waiting for review."><input type="checkbox" disabled aria-label={'Already on its way: ' + k.keyword} /></span>
                : <Checkbox key="c" label={'Select: ' + k.keyword} checked={picked.includes(k.keyword)} onChange={() => toggle(k.keyword)} />] : []),
              <b key="k">{k.keyword}</b>, k.meaning,
              ...(withVolume ? [<span key="v">{volumeText(k)}{k.volumeGroup ? <small className="note"> · shared group: {k.volumeGroup}</small> : null}</span>, COMPETITION[k.competition ?? ''] ?? '—'] : []),
              k.intent, k.cluster, k.basis,
              ...(canTrack ? [k.id != null ? <Checkbox key="t" label={'Track the position of: ' + k.keyword} checked={!!k.track} onChange={() => void track(k.id!, !k.track)} /> : null] : []),
              busy(k.keyword) ? <Pill key="w" kind="info">Article on its way</Pill>
                : <Button key="w" variant="text" size="sm" icon="edit_note" onClick={() => write([k.keyword])}>Write article</Button>,
            ])}
          />
          {bulk ? (
            <div className="kw-bulk">
              <p className="note">
                {chosen.length > BULK_MAX ? `Choose at most ${BULK_MAX} at a time: ${chosen.length} are ticked.`
                  : chosen.length ? `${chosen.length} of ${free.length} ticked. Each one is a separate job for the Content Writer.`
                    : 'Tick several keywords to send them to the Content Writer in one go.'}
              </p>
              {chosen.length ? <Button variant="text" size="sm" onClick={() => setPicked([])}>Clear</Button> : null}
              <Button variant="tonal" size="sm" icon="edit_note" disabled={!chosen.length || chosen.length > BULK_MAX} onClick={() => write(chosen)}>Write selected ({chosen.length})</Button>
            </div>
          ) : null}
          {withVolume ? <p className="note">Volume is approximate monthly searches in {keywords.find(k => k.volumeAt)?.volumeCountry || r.country || 'the site\'s country'} ({keywords.find(k => k.volumeAt)?.volumeLanguage || r.lang}) from {keywords.some(k => k.volumeProvider === 'ads') ? 'Google Ads directly' : 'Google Ads via DataForSEO'}. Competition is among advertisers, not ranking difficulty. Shared groups must not be added together; a dash means unknown. Last fetched: {keywords.find(k => k.volumeAt)?.volumeAt ? dayTime(keywords.find(k => k.volumeAt)!.volumeAt!) : '—'}.</p> : null}
          {r.notes ? <Info label="Research notes and limitations"><p className="note">{r.notes}</p></Info> : null}
        </>
      )}
      {r.st === 'done' && (dfs || ads) && mayWrite && keywords.length ? <Field label="Keyword volume source"><Select label="Keyword volume source" value={selectedProvider} onChange={v => setVolumeProvider(v as 'ads' | 'dfs')} disabled={volBusy} options={Object.entries(VOLUME_PROVIDERS).filter(([id]) => id === 'ads' ? ads : dfs).map(([value, label]) => ({value, label}))} /></Field> : null}
      <SheetActions>
        <Button variant="text" icon="refresh" onClick={again}>Run again</Button>
        {r.st === 'done' && (dfs || ads) && mayWrite && keywords.length ? <Button variant="text" icon="query_stats" disabled={volBusy} onClick={refreshVolumes}>{volBusy ? 'Refreshing…' : 'Refresh volumes'}</Button> : null}
        <Button variant="filled" onClick={onClose}>Close</Button>
      </SheetActions>
      <WriteArticleSheet target={target} onClose={() => { setTarget(null); setPicked([]); }} />
    </>
  );
}
