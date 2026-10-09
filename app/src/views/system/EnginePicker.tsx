import { useState } from 'react';
import { Button, Card, Field, Pill, Select } from '@/components';
import { refreshEngine, selectEngine } from '@/store/live';
import { engineName } from '@/store/rules';
import { useStore } from '@/store/store';

const OPTIONS = [
  {value:'gemma-local',label:'Gemma localhost (Ollama)'},
  {value:'codex-local',label:'Codex local'},
  {value:'openai-api',label:'OpenAI API'},
];
export function EnginePicker() {
  const engine = useStore(s => s.live.engine);
  const admin = useStore(s => s.session?.role === 'admin');
  const [busy,setBusy] = useState(false);
  const pick = async (mode: string) => { setBusy(true); await selectEngine(mode); setBusy(false); };
  return <section>
    <h2>Agent engine</h2>
    <Card>
      <Field label="Use for new AI jobs" wide><Select id="engine-mode" label="Agent engine" value={engine?.mode === 'none' ? 'openai-api' : engine?.mode || 'openai-api'} options={OPTIONS} disabled={busy || !admin || !engine} onChange={pick} /></Field>
      <div className="row"><Pill kind={engine?.ready ? 'ok' : 'warn'}>{engine?.ready ? 'Ready' : 'Needs setup'}</Pill><span>{engineName(engine?.mode)}{engine?.model ? ' · ' + engine.model : ''}</span></div>
      <p className="note">{engine?.mode === 'gemma-local' ? 'Runs on this computer. Sources can be read online; web search is unavailable.' : engine?.mode === 'codex-local' ? 'Codex on this computer uses your ChatGPT usage limits.' : 'Uses your connected OpenAI API account.'}</p>
      {engine?.reason ? <p className="err">{engine.reason}</p> : null}
      <Button variant="text" icon="refresh" disabled={busy} onClick={() => void refreshEngine()}>Check again</Button>
    </Card>
  </section>;
}
