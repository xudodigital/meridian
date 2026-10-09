import { useState } from 'react';
import { Callout, Cards, Info } from '@/components';
import { localRuntime } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Integration } from '@/store/types';
import { EnginePicker } from './system/EnginePicker';
import { IntCard } from './system/IntCard';
import { ReplaceKeyForm } from './system/ReplaceKeyForm';
import { ServiceSheet } from './system/ServiceSheet';

const DELIVERY = new Set(['slack', 'tg', 'email']);

/** Integrations: OpenAI, data services and delivery. Prototype: intCard() and vIntegrations(), lines 1639-1654. Slice: system. */
export function Integrations() {
  const local = useStore(localRuntime);
  const ints = useStore(s => s.ints);
  const sample = useStore(s => s.sample);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const card = (n: Integration) => <IntCard key={n.id} n={n} onReplace={setReplacing} onSetup={setSetup} />;
  return (
    <>
      <p className="lede">{local ? 'Your selected engine powers the agents. Add services when needed.' : 'Connect OpenAI and the services your sites need.'}</p>
      {sample
        ? <Callout icon="shield" warn><b>Do not paste a real key.</b> In demo mode keys are not stored or sent; only the last 4 characters are remembered while the page is open.</Callout>
        : <Callout icon="lock" info><b>Keys are encrypted on this computer.</b> Saving tests the connection.</Callout>}
      {sample ? null : <EnginePicker />}
      <section>
        <h2>{local ? 'OpenAI API (optional)' : 'OpenAI'}</h2>
        <p className="note">{local ? 'Available when you choose OpenAI API as the engine.' : 'Powers your AI agents.'}</p>
        <Info label={local ? "Connection details" : "Connection and billing details"}><p>Keys stay encrypted on this computer. The server tests each connection when saved. Keep the encryption key with any manual backup.</p>{local ? null : <p>GPT-6 Luna handles simple volume work; GPT-6.1 Sol is the balanced default for complex work. GPT-6 Astra is available for manual selection. Standard OpenAI list prices are shown per million input/output tokens; recorded costs are estimated from reported usage, caching and web search calls.</p>}</Info>
        <Cards>{ints.filter(n => n.ai).map(card)}</Cards>
      </section>
      {sample ? null : <section><h2>Gemma localhost</h2><Cards>{ints.filter(n => n.id === 'gemma').map(card)}</Cards></section>}
      <section>
        <h2>Data and checks</h2>
        {sample ? null : <p className="note">Research, search performance and website delivery.</p>}
        <Cards>{ints.filter(n => !n.ai && n.id !== 'gemma' && !DELIVERY.has(n.id)).map(card)}</Cards>
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
