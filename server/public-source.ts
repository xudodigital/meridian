// Read-only source tool for local models. Pin DNS on each hop and reject non-public destinations.
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function publicAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false; // IPv4 only: do not allow mapped IPv6 or private IPv6 ranges.
  const [a, b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a! >= 224 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b! >= 64 && b! <= 127 || a === 198 && (b === 18 || b === 19));
}
export function sourceUrl(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || value.length > 2000) throw new Error('Sources must be public HTTPS pages without credentials.');
  if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.[a-z.]+)$/.test(u.hostname) && /^\/search/.test(u.pathname)) throw new Error('Direct search-engine scraping is unavailable. Use the SERP research workflow with DataForSEO.');
  return u;
}
export async function readPublicSource(value: string, signal: AbortSignal, hops = 0): Promise<{ url: string; text: string }> {
  signal.throwIfAborted();
  const u = sourceUrl(value);
  const ips = await lookup(u.hostname, { all: true, family: 4 });
  if (!ips.length || ips.some(x => !publicAddress(x.address))) throw new Error('This source does not resolve to a public address.');
  signal.throwIfAborted();
  const page = await new Promise<{ status: number; location: string; type: string; text: string }>((resolve, reject) => {
    const req = request(u, { signal, lookup: (_host, _options, cb) => cb(null, ips[0]!.address, 4), headers: { 'user-agent': 'Meridian/0.1 (editorial source check)', accept: 'text/html, text/plain' } }, res => {
      const status = res.statusCode || 0, location = String(res.headers.location || ''), type = String(res.headers['content-type'] || '');
      if (status >= 300 && status < 400 || status !== 200 || !/^(text\/html|text\/plain)/i.test(type)) { res.resume(); resolve({status,location,type,text:''}); return; }
      let bytes = 0; const chunks: Buffer[] = [];
      res.on('data', (b: Buffer) => { bytes += b.length; if (bytes > 2 * 1024 * 1024) res.destroy(new Error('The source is too large.')); else chunks.push(b); });
      res.on('error', reject);
      res.on('end', () => resolve({ status, location, type, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(20000, () => req.destroy(new Error('The source timed out.')));
    req.on('error', reject); req.end();
  });
  if (page.status >= 300 && page.status < 400) {
    if (!page.location || hops >= 3) throw new Error('The source redirected too many times.');
    return readPublicSource(new URL(page.location, u).href, signal, hops + 1);
  }
  if (page.status !== 200) throw new Error(`The source answered HTTP ${page.status}.`);
  if (!page.text) throw new Error('The source has no readable HTML or plain text.');
  const text = page.text.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 18000);
  if (text.length < 100) throw new Error('The source did not contain enough readable text; it may need JavaScript or sign-in.');
  return { url: u.href, text };
}
