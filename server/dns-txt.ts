import { Resolver } from 'node:dns/promises';

type TxtLookup = (name: string) => Promise<string[][]>;
type DnsAnswer = { name?: string; type?: number; data?: string };
const owner = (name: string) => name.toLowerCase().replace(/\.$/, '');
const dnsError = (code: string) => Object.assign(new Error('The public TXT lookup failed.'), { code });

/** HTTPS fallback for networks where public UDP DNS is filtered or returns stale negative answers.
 * Schema: https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/
 * No credentials are sent. Only records for the exact requested owner and type are accepted.
 */
export async function lookupTxtOverHttps(name: string, request: typeof fetch = fetch): Promise<string[][]> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', name);
  url.searchParams.set('type', 'TXT');
  const response = await request(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw dnsError('EAI_AGAIN');
  const data = await response.json() as { Status?: number; TC?: boolean; Question?: DnsAnswer[]; Answer?: DnsAnswer[] };
  if (data.TC || !Array.isArray(data.Question) || !data.Question.some(q => typeof q.name === 'string' && owner(q.name) === owner(name) && q.type === 16)) throw dnsError('EAI_AGAIN');
  if (data.Status === 3) throw dnsError('ENOTFOUND');
  if (data.Status !== 0) throw dnsError('EAI_AGAIN');
  if (data.Answer !== undefined && !Array.isArray(data.Answer)) throw dnsError('EAI_AGAIN');
  const records: string[][] = [];
  for (const record of data.Answer ?? []) {
    if (record.type !== 16 || typeof record.name !== 'string' || owner(record.name) !== owner(name)) continue;
    if (typeof record.data !== 'string') throw dnsError('EAI_AGAIN');
    const chunks = record.data.match(/"(?:[^"\\]|\\.)*"/g);
    if (!chunks || record.data.replace(/"(?:[^"\\]|\\.)*"/g, '').trim()) throw dnsError('EAI_AGAIN');
    try { records.push(chunks.map(chunk => JSON.parse(chunk) as string)); }
    catch { throw dnsError('EAI_AGAIN'); }
  }
  if (!records.length) throw dnsError('ENODATA');
  return records;
}

export async function lookupPublicTxt(name: string, primary?: TxtLookup, fallback: TxtLookup = lookupTxtOverHttps): Promise<string[][]> {
  const customServers = process.env.MERIDIAN_DNS_SERVERS;
  const udp = primary ?? ((host: string) => {
    const resolver = new Resolver({ timeout: 5000, tries: 2 });
    resolver.setServers((customServers || '1.1.1.1,8.8.8.8').split(','));
    return resolver.resolveTxt(host);
  });
  try { return await udp(name); }
  catch (error) {
    // Explicit resolver configuration must not silently query another provider.
    if (customServers) throw error;
    return fallback(name);
  }
}
