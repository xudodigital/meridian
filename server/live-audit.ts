// Bounded same-origin observations. DNS is checked and pinned per request; redirects are not followed off-site.
import { resolve4, resolve6 } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !!a && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b! >= 16 && b! <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b! >= 64 && b! <= 127) && !(a === 198 && (b === 18 || b === 19));
  }
  return isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
}
async function page(url: URL, signal: AbortSignal): Promise<{ status: number; headers: Record<string, string>; html: string }> {
  const ips = [...await resolve4(url.hostname).catch(() => []), ...await resolve6(url.hostname).catch(() => [])];
  signal.throwIfAborted();
  if (!ips.length || ips.some(ip => !publicAddress(ip))) throw new Error('Live audit requires a domain resolving only to public addresses.');
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, lookup: (_host, _options, callback) => callback(null, ips[0]!, isIP(ips[0]!)), headers: { 'user-agent': 'MeridianSEOAudit/1.0', accept: 'text/html,text/plain,application/xml' } }, res => {
      const chunks: Buffer[] = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) req.destroy(new Error('Page exceeds the audit size limit.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])), html: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Live page timed out.'))); req.on('error', reject); req.end();
  });
}
export function htmlObservations(html: string, url: string, headers: Record<string, string> = {}) {
  const tag = (name: string, attr: string, value: string) => (html.match(new RegExp(`<${name}\\b[^>]*${attr}\\s*=\\s*["']${value}["'][^>]*>`, 'i')) ?? [])[0] ?? '';
  const canonical = tag('link', 'rel', 'canonical').match(/href\s*=\s*["']([^"']+)/i)?.[1] ?? '';
  const robots = tag('meta', 'name', 'robots').match(/content\s*=\s*["']([^"']+)/i)?.[1] ?? '';
  const schemas = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const invalidSchema = schemas.some(m => { try { JSON.parse(m[1]!); return false; } catch { return true; } });
  return { url, titlePresent: /<title\b[^>]*>[^<]+<\/title>/i.test(html), h1Count: (html.match(/<h1\b/gi) ?? []).length, canonical, robots, xRobots: headers['x-robots-tag'] ?? '', noindex: /\bnoindex\b/i.test(robots + ',' + (headers['x-robots-tag'] ?? '')), schemas: schemas.length, invalidSchema, mobileViewport: /name\s*=\s*["']viewport["']/i.test(html) };
}
export async function auditPublished(domain: string, paths: string[], signal: AbortSignal) {
  const origin = new URL('https://' + domain).origin;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const urls = [...new Set(['/', '/robots.txt', '/sitemap.xml', ...paths])].slice(0, 10);
  const observations: unknown[] = [];
  for (const path of urls) {
    combined.throwIfAborted();
    const url = new URL(path, origin);
    if (url.origin !== origin) continue;
    try {
      const r = await page(url, combined);
      const location = r.headers.location ? new URL(r.headers.location, url) : null;
      observations.push({ path: url.pathname, status: r.status, redirect: location?.href ?? '', redirectSameOrigin: !!location && location.origin === origin, ...(path.endsWith('.txt') || path.endsWith('.xml') ? { excerpt: r.html.slice(0, 4000) } : htmlObservations(r.html, url.href, r.headers)) });
    } catch (e) { if (signal.aborted) throw e; observations.push({ path, error: String((e as Error).message).slice(0, 300) }); }
  }
  return { at: Date.now(), observations, coverage: 'At most 10 known URLs; redirects are recorded, not followed. Robots and sitemap excerpts need interpretation. This is not a full crawl, proof of Google indexing or a Core Web Vitals measurement.' };
}
