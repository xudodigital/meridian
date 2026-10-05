import { useState } from 'react';
import { Button, Callout, Card, Cards, Info, Pill } from '@/components';
import { refreshEngine } from '@/store/live';
import { codexLocal } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Integration } from '@/store/types';
import { IntCard } from './system/IntCard';
import { ReplaceKeyForm } from './system/ReplaceKeyForm';
import { ServiceSheet } from './system/ServiceSheet';

const DELIVERY = new Set(['slack', 'tg', 'email']);

/** Integrations: OpenAI, data services and delivery. Prototype: intCard() and vIntegrations(), lines 1639-1654. Slice: system. */
export function Integrations() {
  const local = useStore(codexLocal);
  const engine = useStore(s => s.live.engine);
  const ints = useStore(s => s.ints);
  const sample = useStore(s => s.sample);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const card = (n: Integration) => <IntCard key={n.id} n={n} onReplace={setReplacing} onSetup={setSetup} />;
  return (
    <>
      <p className="lede">{local ? 'Codex local powers your agents. Add other services when needed.' : 'Connect OpenAI and the services your sites need.'}</p>
      {sample
        ? <Callout icon="shield" warn><b>Do not paste a real key.</b> In demo mode keys are not stored or sent; only the last 4 characters are remembered while the page is open.</Callout>
        : <Callout icon="lock" info><b>Keys are encrypted on this computer.</b> Saving tests the connection.</Callout>}
      {local ? <section><h2>Codex local</h2><Card className="int"><h3>Codex on this computer</h3><Pill kind={engine?.ready ? 'ok' : 'warn'}>{engine?.ready ? 'Ready' : 'Needs attention'}</Pill><p className="note">{engine?.model || 'Local runtime model'} · {engine?.apiVersion}</p><p className="note">Uses your ChatGPT usage limits. No API key is needed; subscription costs are not estimated here.</p>{engine?.reason ? <p className="note">{engine.reason}</p> : null}<Button variant="text" icon="refresh" onClick={() => void refreshEngine()}>Check again</Button></Card></section> : null}
      <section>
        <h2>{local ? 'OpenAI API (optional)' : 'OpenAI'}</h2>
        <p className="note">{local ? 'API keys are used only when the server runs in OpenAI API mode.' : 'Powers your AI agents.'}</p>
        <Info label="Connection and billing details"><p>Keys stay encrypted on this computer. The server tests each connection when saved. Keep the encryption key with any manual backup.</p><p>GPT-6 Luna handles simple volume work; GPT-6.1 Sol is the balanced default for complex work. GPT-6 Astra is available for manual selection. Standard OpenAI list prices are shown per million input/output tokens; recorded costs are estimated from reported usage, caching and web search calls.</p></Info>
        <Cards>{ints.filter(n => n.ai).map(card)}</Cards>
      </section>
      <section>
        <h2>Data and checks</h2>
        {sample ? null : <p className="note">Research, search performance and website delivery.</p>}
        <Cards>{ints.filter(n => !n.ai && !DELIVERY.has(n.id)).map(card)}</Cards>
      </section>
      <section>
        <h2>Alerts and reports</h2>
        <p className="note">Choose alert channels in Settings.</p>
        <Cards>{ints.filter(n => DELIVERY.has(n.id)).map(card)}</Cards>
      </section>
      <ReplaceKeyForm id={replacing} onClose={() => setReplacing(null)} />
      <ServiceSheet id={setup} onClose={() => setSetup(null)} />
    </>
  );
}
