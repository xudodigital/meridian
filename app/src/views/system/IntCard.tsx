import { useState } from 'react';
import { Button, Card, Icon, Info, Pill, Tag } from '@/components';
import { PROV } from '@/store/constants';
import { refreshEngine } from '@/store/live';
import { liveOn, priceNote, provOf } from '@/store/rules';
import { dayTime } from '@/store/rules';
import { statusLabel, usableInt } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import type { EngineStatus, Integration, IntegrationWire, ProviderId } from '@/store/types';

const isProvider = (id: string): id is ProviderId => Object.hasOwn(PROV, id);

/**
 * One integration card: the prototype's intCard(n), lines 1639-1648. `onReplace` opens the Replace key sheet (demo
 * mode) and `onSetup` the Connect / Change sheet (outside demo mode, where everything is stored and tested on the server).
 * In live mode the OpenAI card shows whether the server connection is ready.
 */
export function IntCard({ n, onReplace, onSetup }: { n: Integration; onReplace: (id: string) => void; onSetup: (id: string) => void }) {
  const using = useStore(s => n.ai && s.live.engine?.mode !== 'codex-local' ? s.agents.filter(a => a.id !== 'orc' && a.id !== 'dep' && provOf(a.model) === n.id).length : 0);
  const engine = useStore(s => n.id === 'openai' && liveOn(s) ? s.live.engine : null);
  const sample = useStore(s => s.sample);
  const w = useStore(s => s.sample ? undefined : s.live.ints[n.id]);
  const prov = n.ai && isProvider(n.id) ? PROV[n.id] : null;
  const serverReady = engine?.mode === 'openai-api' && engine.ready === true;
  if (w) {
    return (
      <Card className="int">
        <header>
          <span className={'ava s2 c' + (w.connected && w.status !== 'bad' || serverReady ? 1 : 4)} aria-hidden="true"><Icon name={n.icon} /></span>
          <div className="who"><h3>{w.name}</h3><p>{n.use}</p></div>
        </header>
        <div className="row">
          {serverReady ? <Pill kind="ok">OpenAI ready</Pill> : null}
          {w.connected || !serverReady ? <Pill kind={!w.connected ? 'mut' : w.status === 'ok' || (w.worksWithout && !w.updatedAt) ? 'ok' : w.status === 'bad' ? 'bad' : w.status === 'warn' ? 'warn' : 'info'}>{w.connected && serverReady && n.id === 'openai' ? 'API key: ' + statusLabel(w).toLowerCase() : statusLabel(w)}</Pill> : null}
          {n.ai ? <Pill kind={using ? 'info' : 'mut'}>{using + ' agent' + (using === 1 ? '' : 's')}</Pill> : null}
        </div>
        {prov ? <Info label="Models and prices"><div className="tags">{prov.models.map(m => <Tag key={m} icon="memory">{m + priceNote(m)}</Tag>)}</div></Info> : null}
        {engine ? <OpenAIEngine engine={engine} /> : null}
        <ServiceBody w={w} using={using} onSetup={onSetup} keyOnly={serverReady} />
      </Card>
    );
  }
  if (!sample) {
    /* The server's answer has not arrived yet (it does right after sign-in). */
    return (
      <Card className="int">
        <header>
          <span className={'ava s2 c' + (serverReady ? 1 : 4)} aria-hidden="true"><Icon name={n.icon} /></span>
          <div className="who"><h3>{n.name}</h3><p>{n.use}</p></div>
        </header>
        <div className="row">
          {serverReady ? <Pill kind="ok">OpenAI ready</Pill> : <Pill kind="mut">Not connected</Pill>}
          {n.ai ? <Pill kind={using ? 'info' : 'mut'}>{using + ' agent' + (using === 1 ? '' : 's')}</Pill> : null}
        </div>
        {prov ? <Info label="Models and prices"><div className="tags">{prov.models.map(m => <Tag key={m} icon="memory">{m + priceNote(m)}</Tag>)}</div></Info> : null}
        {engine ? <OpenAIEngine engine={engine} /> : null}
        <p className="note">Loading from the Meridian server…</p>
      </Card>
    );
  }
  return (
    <Card className="int">
      <header>
        <span className={'ava s2 c' + (n.tail || serverReady ? 1 : 4)} aria-hidden="true"><Icon name={n.icon} /></span>
        <div className="who"><h3>{n.name}</h3><p>{n.use}</p></div>
      </header>
      <div className="row">
        {serverReady ? <Pill kind="ok">OpenAI ready</Pill> : null}
        {n.tail ? <Pill kind={n.st || 'ok'}>{n.msg || 'Connected'}</Pill> : serverReady ? null : <Pill kind="mut">Not connected</Pill>}
        {n.ai ? <Pill kind={using ? 'info' : 'mut'}>{using + ' agent' + (using === 1 ? '' : 's')}</Pill> : null}
      </div>
      {prov ? <Info label="Models and prices"><div className="tags">{prov.models.map(m => <Tag key={m} icon="memory">{m + priceNote(m)}</Tag>)}</div></Info> : null}
      {engine ? <OpenAIEngine engine={engine} /> : null}
      {n.type === 'oauth' ? <OAuthBody n={n} /> : n.tail ? <KeyBody n={n} using={using} onReplace={onReplace} /> : serverReady ? null : <KeyForm n={n} />}
    </Card>
  );
}

/** OpenAI connection status and its recovery action. */
function OpenAIEngine({ engine }: { engine: EngineStatus }) {
  if (engine.mode === 'codex-local') return <p className="note">Optional API connection. Agent jobs currently use Codex local.</p>;
  return <p className="note">{engine.ready ? 'Ready for agent jobs.' : 'Connect OpenAI to run agents.'} <button type="button" className="linkbtn" onClick={() => void refreshEngine()}>Check again</button></p>;
}

function OAuthBody({ n }: { n: Integration }) {
  const revokeKey = useStore(s => s.revokeKey);
  const connectOAuth = useStore(s => s.connectOAuth);
  if (!n.tail) return <div className="row"><Button variant="tonal" onClick={() => connectOAuth(n.id)}>Connect with Google</Button></div>;
  return (
    <>
      <p className="key">{n.tail}</p>
      <footer><span className="grow" /><Button size="sm" variant="danger" onClick={() => revokeKey(n.id)}>Disconnect</Button></footer>
    </>
  );
}

function KeyBody({ n, using, onReplace }: { n: Integration; using: number; onReplace: (id: string) => void }) {
  const testKey = useStore(s => s.testKey);
  const guard = useStore(s => s.guard);
  const revokeKey = useStore(s => s.revokeKey);
  const openConfirm = useStore(s => s.openConfirm);
  const revoke = () => { if (n.ai && using) openConfirm(`key:${n.id}`); else revokeKey(n.id); };
  return (
    <>
      <p className="key">••••••••••••{n.tail}</p>
      <footer>
        <Button size="sm" variant="text" onClick={() => testKey(n.id)}>Test connection</Button>
        <Button size="sm" variant="text" onClick={() => { if (guard()) onReplace(n.id); }}>Replace key</Button>
        <span className="grow" />
        <Button size="sm" variant="danger" onClick={revoke}>Revoke</Button>
      </footer>
    </>
  );
}

/** What is stored, how the last test went, and the actions (outside demo mode). */
function ServiceBody({ w, using, onSetup, keyOnly }: { w: IntegrationWire; using: number; onSetup: (id: string) => void; keyOnly: boolean }) {
  const testService = useStore(s => s.testService);
  const removeService = useStore(s => s.removeService);
  const connectOAuth = useStore(s => s.connectOAuth);
  const openConfirm = useStore(s => s.openConfirm);
  const guard = useStore(s => s.guard);
  const googleReady = useStore(s => usableInt(s, 'google'));
  const [busy, setBusy] = useState(false);
  const test = async () => { setBusy(true); await testService(w.id); setBusy(false); };
  const remove = () => { if (w.fields.length && using) openConfirm(`key:${w.id}`); else void removeService(w.id); };
  const masked = w.tail && !w.oauth && ['openai', 'cf', 'slack'].includes(w.id) || (w.id === 'probe' && !!w.updatedAt);
  const stored = !!w.updatedAt;
  const result = w.msg ? <p className="note">{w.msg}{w.testedAt ? <> · <span className="nw">tested {dayTime(w.testedAt)}</span></> : null}</p> : null;

  if (w.oauth) {
    if (!stored) {
      return (
        <>
          {googleReady ? null : <p className="note">Set up Google sign-in first. <button className="linkbtn" onClick={() => onSetup('google')}>Set up</button></p>}
          <footer><Button size="sm" variant="tonal" disabled={!googleReady} onClick={() => { if (guard()) connectOAuth(w.id); }}>Connect with Google</Button></footer>
        </>
      );
    }
    return (
      <>
        <p className="key">{w.tail}</p>
        {result && w.status === 'bad' ? result : result ? <Info label="Connection details">{result}</Info> : null}
        <footer>
          <Button size="sm" variant="text" disabled={busy} onClick={test}>{busy ? 'Testing…' : 'Test connection'}</Button>
          <span className="grow" />
          <Button size="sm" variant="danger" onClick={() => { if (guard()) void removeService(w.id); }}>Disconnect</Button>
        </footer>
      </>
    );
  }
  return (
    <>
      {w.connected ? <p className="key">{masked ? '••••••••••••' + w.tail : w.tail}</p> : null}
      {result && w.status === 'bad' ? result : result ? <Info label="Connection details">{result}</Info> : null}
      {!stored && w.worksWithout ? <Info label="Public access limits"><p>{w.worksWithout}</p></Info> : null}
      <footer>
        {stored || w.worksWithout ? <Button size="sm" variant="text" disabled={busy} onClick={test}>{busy ? 'Testing…' : 'Test connection'}</Button> : null}
        <Button size="sm" variant={stored ? 'text' : 'tonal'} onClick={() => { if (guard()) onSetup(w.id); }}>{stored ? 'Change' : w.worksWithout ? 'Add token' : keyOnly ? 'Add API key' : 'Connect'}</Button>
        <span className="grow" />
        {stored ? <Button size="sm" variant="danger" onClick={() => { if (guard()) remove(); }}>Remove</Button> : null}
      </footer>
    </>
  );
}

function KeyForm({ n }: { n: Integration }) {
  const saveKey = useStore(s => s.saveKey);
  const [key, setKey] = useState('');
  return (
    <form onSubmit={e => { e.preventDefault(); saveKey(n.id, key); }}>
      <input type="password" id={'key-' + n.id} autoComplete="off" placeholder="Paste API key" aria-label={'API key for ' + n.name} required minLength={8} value={key} onChange={e => setKey(e.target.value)} />
      <Button type="submit" variant="tonal">Save</Button>
    </form>
  );
}
