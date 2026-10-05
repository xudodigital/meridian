import { Button, Callout, Sheet, SheetActions, Table, Tabs } from '@/components';
import { PROV, PROVIDER_IDS } from '@/store/constants';
import { costOf, provOK, provPlan, skillClash } from '@/store/rules';
import { useStore } from '@/store/store';
import type { ProviderId } from '@/store/types';

/** The prototype's openProv(pid), lines 1617-1631: move every agent to one provider. */
export function ProviderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Switch provider" size="wide" description="Move every agent to one provider. Each agent gets the model that matches its current tier; you can still change single agents afterwards.">
      <ProviderPlan onClose={onClose} />
    </Sheet>
  );
}

/** Extra sentences of the cost note for the providers with models that are never assigned automatically. */
function providerNote(_pid: ProviderId): string { return ' GPT-6 Astra is available for manual selection on demanding work.'; }

function ProviderPlan({ onClose }: { onClose: () => void }) {
  const pid = useStore(s => s.provTo) ?? 'openai';
  const agents = useStore(s => s.agents);
  const skills = useStore(s => s.skills);
  const ints = useStore(s => s.ints);
  const live = useStore(s => s.live);
  const pickProvider = useStore(s => s.pickProvider);
  const applyProvider = useStore(s => s.applyProvider);

  const ok = provOK({ ints, live }, pid), plan = provPlan({ agents }, pid), name = PROV[pid].name;
  const now = agents.reduce((n, a) => n + costOf(a.tokens, a.model), 0), after = plan.reduce((n, p) => n + costOf(p.a.tokens, p.to), 0);
  const clash = plan.filter(p => p.a.skills.some(id => { const k = skills.find(x => x.id === id); return !!k && !!k.only && k.only !== pid; }));
  const clashSkills = [...new Set(clash.flatMap(p => skillClash({ skills }, { skills: p.a.skills, model: p.to }).map(k => k.name)))];

  return (
    <>
      <Tabs label="Provider" value={pid} onChange={pickProvider} items={PROVIDER_IDS.map(k => ({ id: k, label: PROV[k].name + (provOK({ ints, live }, k) ? '' : ' (key missing)') }))} />
      {ok ? null : <Callout icon="key" warn>Add the {name} API key in Integrations before switching.</Callout>}
      <Table
        responsive="container"
        cols={['Agent', 'Now', 'After', 'Today at new rate']}
        num={[3]}
        rowKey={(_, i) => plan[i].a.id}
        rows={plan.map(p => [
          <b>{p.a.name}</b>,
          <span className="nw">{p.a.model}</span>,
          <span className="nw">{p.to === p.a.model ? p.to : <b>{p.to}</b>}</span>,
          '$' + costOf(p.a.tokens, p.to).toFixed(2),
        ])}
      />
      <p className="note">Today's tokens cost about ${now.toFixed(2)} on the current models and would cost about ${after.toFixed(2)} after the switch (standard list prices, three input tokens per output token, no caching or batch discount).{providerNote(pid)}</p>
      {clash.length ? (
        <Callout icon="psychology" warn>{clash.map(p => p.a.name).join(', ')} {clash.length === 1 ? 'uses' : 'use'} a skill written for another provider ({clashSkills.join(', ')}). Review or replace it before the next job.</Callout>
      ) : null}
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" disabled={!ok} onClick={() => { if (applyProvider(pid)) onClose(); }}>Switch to {name}</Button>
      </SheetActions>
    </>
  );
}
