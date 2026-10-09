import { useState, type FormEvent } from 'react';
import { Button, Field, Fields, Select, Sheet, SheetActions } from '@/components';
import { COUNTRIES } from '@/store/rules';
import type { NewSiteStatus } from '@/store/slices/sites';
import { useStore } from '@/store/store';

const COUNTRY_OPTIONS = COUNTRIES.map((c, i) => ({ value: String(i), label: c[0] }));
const STATUS_OPTIONS: readonly { value: NewSiteStatus; label: string }[] = [{ value: 'build', label: 'Being set up' }, { value: 'live', label: 'Already live' }];

/**
 * The prototype's "site" form (openForm('site'), line 1899). In demo mode it adds a domain that waits for DNS and
 * starts the "New site" workflow; otherwise it records the domain with the status the person gives.
 */
export function AddSiteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="sheetT">
      <AddSiteForm onClose={onClose} />
    </Sheet>
  );
}

function AddSiteForm({ onClose }: { onClose: () => void }) {
  const addSite = useStore(s => s.addSite);
  const sample = useStore(s => s.sample);
  const [status, setStatus] = useState<NewSiteStatus>('build');
  const [domain, setDomain] = useState('');
  const [country, setCountry] = useState(sample ? 0 : -1);
  const [lang, setLang] = useState(sample ? COUNTRIES[0][2] : '');
  const [topic, setTopic] = useState('');
  const [msg, setMsg] = useState('');

  /* Picking a country fills in its usual content language (the prototype's sdCountry change). */
  const pickCountry = (v: string) => { const i = v === '' ? -1 : Number(v); setCountry(i); setLang(COUNTRIES[i]?.[2] ?? ''); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (country < 0) { setMsg('Choose the target country for your site.'); return; }
    const err = addSite({ domain, country, lang, topic, status });
    if (err) setMsg(err); else onClose();
  };

  return (
    <form onSubmit={submit}>
      <h2 id="sheetT">Add a domain</h2>
      <p>{sample ? 'After the domain is verified, the "New site" workflow runs with this profile.' : 'Agents use this profile whenever they work for the site, for example on a research request.'}</p>
      {sample ? null : <p className="note">Saves a site profile for local research and preview. Domain purchase, DNS and publication are separate.</p>}
      <Fields>
        <Field label="Domain" wide><input type="text" id="sdDomain" required placeholder="domain-f.example" value={domain} onChange={e => setDomain(e.target.value)} /></Field>
        <Field label="Target country"><Select id="sdCountry" label="Target country" value={country < 0 ? '' : String(country)} options={sample ? COUNTRY_OPTIONS : [{ value: '', label: 'Choose a country' }, ...COUNTRY_OPTIONS]} onChange={pickCountry} /></Field>
        <Field label="Content language"><input type="text" id="sdLang" required maxLength={120} value={lang} onChange={e => setLang(e.target.value)} /></Field>
        <Field label="Site topic" wide><input type="text" id="sdTopic" required maxLength={120} aria-describedby="site-topic-hint" placeholder="Home cooking recipes" value={topic} onChange={e => setTopic(e.target.value)} /><span id="site-topic-hint" className="note">One line, up to 120 characters.</span></Field>
        {sample ? null : (
          <Field label="Status" wide>
            <Select id="sdStatus" label="Status" value={status} options={STATUS_OPTIONS} onChange={v => { const o = STATUS_OPTIONS.find(x => x.value === v); if (o) setStatus(o.value); }} />
          </Field>
        )}
      </Fields>
      {sample ? null : <p className="note">Choose your audience’s country and article language. Use “Being set up” for a new site.</p>}
      <p className="err" id="formMsg" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" type="submit">Add domain</Button>
      </SheetActions>
    </form>
  );
}
