// Domain ownership by a DNS TXT record: the admin adds _meridian.<domain> with the value Meridian shows, and Meridian
// looks it up on public resolvers. The value is derived from the server's key (vault.ts), so it stays the same for a
// site and cannot be guessed by someone else.
import { lookupPublicTxt } from './dns-txt.ts';
import { db } from './db.ts';
import { derive } from './vault.ts';
import { siteInfo, siteList } from './workspace.ts';

export type VerifyView = { siteId: string; domain: string; host: string; value: string; verifiedAt: number | null; by: string };

const qv = {
  get: db.prepare('SELECT * FROM site_verifications WHERE site_id = ? AND domain = ?'),
  all: db.prepare('SELECT * FROM site_verifications'),
  put: db.prepare('INSERT OR REPLACE INTO site_verifications (site_id, domain, verified_at, by) VALUES (?, ?, ?, ?)'),
};
type Row = { site_id: string; domain: string; verified_at: number; by: string };

export const recordHost = (domain: string): string => '_meridian.' + domain;
export const recordValue = (siteId: string, domain: string): string => 'meridian-verify=' + derive('dns-verify', siteId + '|' + domain).slice(0, 32);

export function verifyViews(): VerifyView[] {
  const done = new Map((qv.all.all() as Row[]).map(r => [r.site_id + '|' + r.domain, r]));
  return siteList().map(s => {
    const r = done.get(s.id + '|' + s.domain);
    return { siteId: s.id, domain: s.domain, host: recordHost(s.domain), value: recordValue(s.id, s.domain), verifiedAt: r?.verified_at ?? null, by: r?.by ?? '' };
  });
}

type TxtLookup = (name: string) => Promise<string[][]>;
let lookup: TxtLookup = lookupPublicTxt;
/** Tests replace the DNS lookup. */
export const setTxtLookup = (fn: TxtLookup) => { lookup = fn; };

/** Looks the record up. Resolves to the verified view, or the reason it is not verified yet. */
export async function verifySite(siteId: string, by: string): Promise<{ ok: true; view: VerifyView } | { ok: false; error: string }> {
  const s = siteInfo(siteId);
  if (!s) return { ok: false, error: 'That site is not in the workspace.' };
  const host = recordHost(s.domain), want = recordValue(s.id, s.domain);
  let records: string[];
  try { records = (await lookup(host)).map(parts => parts.join('')); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { ok: false, error: `No TXT record at ${host} yet. DNS changes can take up to an hour to show.` };
    return { ok: false, error: `The DNS lookup of ${host} failed (${code || 'no answer'}). Try again in a minute.` };
  }
  if (!records.some(r => r.trim() === want)) {
    return { ok: false, error: records.length ? `${host} has a TXT record, but not the value Meridian asked for. Check for typos or quotes.` : `No TXT record at ${host} yet.` };
  }
  const at = Date.now();
  qv.put.run(s.id, s.domain, at, by);
  return { ok: true, view: { siteId: s.id, domain: s.domain, host, value: want, verifiedAt: at, by } };
}
