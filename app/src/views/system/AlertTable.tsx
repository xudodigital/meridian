import { Checkbox } from '@/components';
import { CH, EVENTS } from '@/store/constants';
import { useStore } from '@/store/store';

/**
 * The alert table of Settings: one row per event, one checkbox per channel (vSettings, line 1667). Email, Slack and
 * Telegram can be chosen once they are connected in Integrations; outside demo mode the server sends them.
 */
export function AlertTable() {
  const np = useStore(s => s.np);
  const ints = useStore(s => s.ints);
  const sample = useStore(s => s.sample);
  const setAlert = useStore(s => s.setAlert);
  const connected = (id: string): boolean => { const n = ints.find(x => x.id === id); return !!n?.tail && n.st !== 'bad'; };
  /* Demo: In-app and Email always work. Otherwise each channel needs its service connected and working. */
  const chok = [true, sample || connected('email'), connected('slack'), connected('tg')];
  const why = 'not connected';
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr><th>Alert</th>{CH.map((c, i) => <th key={c}>{c}{chok[i] ? null : <><br />{why}</>}</th>)}</tr>
        </thead>
        <tbody>
          {EVENTS.map(([ev, label]) => (
            <tr key={ev}>
              <td style={{ minWidth: 220 }}><b>{label}</b></td>
              {CH.map((c, i) => (
                <td key={c} className="c" data-label={c + (chok[i] ? '' : ` (${why})`)}>
                  <Checkbox id={`np-${ev}-${i}`} label={`${label}, by ${c}`} checked={np[ev][i] && chok[i]} disabled={!chok[i]} onChange={e => setAlert(ev, i, e.target.checked)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
