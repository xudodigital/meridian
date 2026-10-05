import { useState } from 'react';
import { Button, Sheet, SheetActions } from '@/components';
import { dayTime } from '@/store/rules';
import { useStore } from '@/store/store';

/** Proving control of a domain: the TXT record to add at the DNS provider, and a button that looks it up. */
export function VerifySheet({ siteId, onClose }: { siteId: string | null; onClose: () => void }) {
  const v = useStore(s => siteId ? s.live.verify[siteId] : undefined);
  return (
    <Sheet open={!!v} onClose={onClose} title={v ? 'Verify ' + v.domain : ''}
      description="Add this TXT record where the domain's DNS is managed (for example Cloudflare or the registrar). It shows Meridian, and anyone you work with, that you control the domain. It changes nothing on the website.">
      {v ? <VerifyBody key={v.siteId} siteId={v.siteId} onClose={onClose} /> : null}
    </Sheet>
  );
}

function VerifyBody({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const v = useStore(s => s.live.verify[siteId])!;
  const verifyOwnership = useStore(s => s.verifyOwnership);
  const snack = useStore(s => s.snack);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const copy = (t: string) => { navigator.clipboard.writeText(t).then(() => snack('Copied'), () => undefined); };
  const check = async () => { setBusy(true); setMsg(''); const err = await verifyOwnership(siteId); setBusy(false); if (err) setMsg(err); };
  return (
    <>
      <table>
        <tbody>
          <tr><th>Type</th><td><code>TXT</code></td><td /></tr>
          <tr><th>Name</th><td><code>{v.host}</code></td><td><Button size="sm" variant="text" onClick={() => copy(v.host)}>Copy</Button></td></tr>
          <tr><th>Value</th><td><code style={{ wordBreak: 'break-all' }}>{v.value}</code></td><td><Button size="sm" variant="text" onClick={() => copy(v.value)}>Copy</Button></td></tr>
        </tbody>
      </table>
      <p className="note">Some DNS providers want only <code>_meridian</code> as the name; they add the domain themselves. A new record can take up to an hour to show.</p>
      {v.verifiedAt ? <p className="note"><b>Verified</b> {dayTime(v.verifiedAt)}{v.by ? ' by ' + v.by : ''}. You can remove the record now, or keep it to verify again later.</p> : null}
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Close</Button>
        <Button variant="filled" disabled={busy} onClick={check}>{busy ? 'Looking it up…' : v.verifiedAt ? 'Verify again' : 'Verify'}</Button>
      </SheetActions>
    </>
  );
}
