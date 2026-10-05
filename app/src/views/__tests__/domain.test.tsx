// @vitest-environment jsdom
/* The Domain step of Build and deploy outside demo mode (views/deploy/DomainStep.tsx): the four steps, the server's
   message, the DNS record to add, "Check again", and what the Sites table and the remove dialog say. The server is a
   fake (fakeApi.ts); every state shown is one the server sent. */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { allOk, serverArticle } from '@/store/articleFixtures';
import { buildWire, cloudflareWire } from '@/store/buildFixtures';
import { domainNote, domainOf, domainStep, liveDomainTo } from '@/store/domains';
import { FakeApi, answer } from '@/store/fakeApi';
import { liveApply } from '@/store/liveApply';
import { serverFactsTo } from '@/store/serverFacts';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import type { BuildWire, DomainWire, Role } from '@/store/types';
import { Deploy } from '../Deploy';
import { SitesTable } from '../sites/SitesTable';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList);
  window.Element.prototype.scrollIntoView = () => {};
  const D = window.HTMLDialogElement.prototype;
  D.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  D.close = function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
});

let root: Root | null = null;
const $$ = (sel: string, from: ParentNode = document) => [...from.querySelectorAll<HTMLElement>(sel)];
const st = () => useStore.getState();
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const unmount = async () => { if (root) { const r = root; await act(async () => { r.unmount(); }); root = null; } };
const mount = async (node: ReactNode) => {
  await unmount();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root') as HTMLElement);
  await act(async () => { root?.render(node); });
};
const change = (fn: () => void) => act(async () => { fn(); });

let api: FakeApi;
let site = '', other = '';
let clock = 1_800_000_000_000;
const later = () => ++clock;
const liveBuild = (over: Partial<BuildWire> = {}) => buildWire(3, site, 'kopi.example', 1, { review: 'approved', decidedBy: 'Dana Owner', deploy: 'live', deployUrl: 'https://kopi-example.pages.dev', deployedAt: clock, ...over });
const domain = (over: Partial<DomainWire> = {}): DomainWire => ({
  siteId: site, domain: 'kopi.example', project: 'kopi-example', status: 'dns', problem: '', message: 'The DNS of kopi.example is not in this Cloudflare account. Add the record below where its DNS is managed, then press Check again.',
  cfStatus: 'pending', method: 'http', txt: null, dnsBy: 'you', record: { type: 'CNAME', name: 'kopi.example', content: 'kopi-example.pages.dev', proxied: true },
  pagesUrl: 'https://kopi-example.pages.dev', checkedAt: clock, startedAt: clock, liveAt: null, nextCheckAt: clock + 15_000, updatedAt: later(), ...over,
});
const serve = (o: { builds?: BuildWire[]; domains?: DomainWire[]; cf?: boolean } = {}) => change(() => useStore.setState(d => {
  d.live.on = true;
  d.live.arts[5] = serverArticle(5, { siteId: site, domain: 'kopi.example', status: 'approved', checks: allOk(), languageReview: { by: 'Dewi', at: 1 } });
  (o.builds ?? []).forEach(b => { d.live.builds[b.id] = b; });
  (o.domains ?? []).forEach(x => { d.live.domains[x.siteId] = x; });
  d.live.ints = { cf: cloudflareWire(o.cf !== false) };
  liveApply(d); serverFactsTo(d); d.live.ready = true;
}));
const as = (role: Role) => change(() => st().signIn(meFor(role, 'Dana Owner', role + '@example.com')));
const box = () => document.querySelector<HTMLElement>('.web-domain[aria-label="Domain of kopi.example"]');
const steps = () => $$('.web-dom-steps li', box() ?? document).map(li => `${li.className || 'todo'}:${li.textContent?.replace(/^(check|priority_high|\d)/, '')}`);
const button = (label: string) => $$('button', box() ?? document).find(b => b.textContent === label);
const push = (d: DomainWire) => change(() => useStore.setState(s => { liveDomainTo(s, d); }));

beforeEach(() => {
  localStorage.clear();
  resetStore(false);
  st().signIn(meFor('admin', 'Dana Owner', 'owner@example.com'));
  st().addSite({ domain: 'kopi.example', country: 0, lang: 'Vietnamese', topic: 'Coffee', status: 'build' });
  st().addSite({ domain: 'masak.example', country: 12, lang: 'Indonesian', topic: 'Cooking', status: 'build' });
  [site, other] = st().sites.map(s => s.id) as [string, string];
  api = new FakeApi();
  vi.stubGlobal('fetch', api.fetch);
  vi.spyOn(console, 'error');
});
afterEach(async () => {
  await unmount();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Domain step', () => {
  it('is not shown before the first deploy, then starts at Not attached with the pages.dev address', async () => {
    await serve();
    await mount(<Deploy />);
    expect(box()).toBeNull();
    await change(() => useStore.setState(d => { d.live.builds[3] = liveBuild(); }));
    expect(steps()).toEqual(['now:Not attached', 'todo:Waiting for DNS', 'todo:Issuing certificate', 'todo:Live']);
    expect(box()?.querySelector('[aria-current="step"]')?.textContent).toContain('Not attached');
    expect(box()?.querySelector('.web-dom-msg')?.textContent).toBe('kopi.example is not connected to the Pages project yet.');
    const pages = $$('a', box()!).find(a => a.textContent === 'https://kopi-example.pages.dev');
    expect([pages?.getAttribute('href'), pages?.getAttribute('rel')]).toEqual(['https://kopi-example.pages.dev', 'noopener noreferrer']);
    expect(box()?.textContent).toContain('Its pages.dev address works already');
    expect(button('refreshConnect domain')).toBeTruthy();
    /* The other site was never deployed: no step for it. */
    expect($$('.web-domain')).toHaveLength(1);
  });

  it('shows the exact record to add and checks again on request', async () => {
    await serve({ builds: [liveBuild()], domains: [domain()] });
    await mount(<Deploy />);
    expect(steps()).toEqual(['done:Not attached', 'now:Waiting for DNS', 'todo:Issuing certificate', 'todo:Live']);
    expect(box()?.querySelector('.web-dom-msg')?.textContent).toBe('The DNS of kopi.example is not in this Cloudflare account. Add the record below where its DNS is managed, then press Check again.');
    const table = box()?.querySelector('table[aria-label="DNS record for kopi.example"]');
    expect($$('tr', table!).map(tr => $$('th, td', tr).slice(0, 2).map(c => c.textContent).join(' = '))).toEqual([
      'Type = CNAME', 'Name = kopi.example', 'Target = kopi-example.pages.dev', 'Proxy = Proxied (orange cloud) when the DNS is at Cloudflare',
    ]);
    expect(box()?.textContent).toContain('Meridian keeps checking by itself');

    api.on('POST', `/api/sites/${site}/domain/check`, () => ({ domain: domain({ status: 'cert', dnsBy: 'you', record: null, cfStatus: 'pending', message: 'The DNS of kopi.example points at the site. Cloudflare is issuing the certificate, which usually takes a few minutes.' }) }));
    await click(button('refreshCheck again'));
    await settle();
    const [call] = api.to('POST', `/api/sites/${site}/domain/check`);
    expect(call?.headers['x-meridian']).toBe('1');
    expect(steps()).toEqual(['done:Not attached', 'done:Waiting for DNS', 'now:Issuing certificate', 'todo:Live']);
    expect(box()?.querySelector('table')).toBeNull();
    expect(st().snackMsg?.msg).toBe('Checked again. The DNS of kopi.example points at the site. Cloudflare is issuing the certificate, which usually takes a few minutes.');

    /* The event stream reports it live: the step says where, the button and the pages.dev note go. */
    await push(domain({ status: 'live', record: null, cfStatus: 'active', nextCheckAt: null, liveAt: clock, message: 'Live on https://kopi.example' }));
    expect(steps()).toEqual(['done:Not attached', 'done:Waiting for DNS', 'done:Issuing certificate', 'done:Live on https://kopi.example']);
    const open = $$('a', box()!).find(a => a.textContent === 'open_in_newOpen https://kopi.example');
    expect([open?.getAttribute('href'), open?.getAttribute('target'), open?.getAttribute('rel')]).toEqual(['https://kopi.example', '_blank', 'noopener noreferrer']);
    expect(button('refreshCheck again')).toBeUndefined();
    expect(box()?.textContent).not.toContain('pages.dev address works already');
  });

  it('shows the TXT record Cloudflare asks for, and a problem in plain words on the step it stopped at', async () => {
    await serve({ builds: [liveBuild()], domains: [domain({ method: 'txt', txt: { name: '_acme-challenge.kopi.example', value: 'abc123' } })] });
    await mount(<Deploy />);
    expect(box()?.querySelector('table')?.getAttribute('aria-label')).toBe('DNS records for kopi.example');
    expect(box()?.textContent).toContain('_acme-challenge.kopi.example');
    expect(box()?.textContent).toContain('abc123');

    const conflict = 'kopi.example already has an A record to 203.0.113.7 in Cloudflare DNS that Meridian did not create, so Meridian left it alone. Change it yourself to one proxied CNAME to kopi-example.pages.dev, or remove it, then press Check again.';
    await push(domain({ status: 'error', problem: 'conflict', message: conflict, nextCheckAt: null }));
    expect(steps()).toEqual(['done:Not attached', 'bad:Waiting for DNS', 'todo:Issuing certificate', 'todo:Live']);
    expect(box()?.querySelector('.pill.bad')?.textContent).toBe('Needs attention');
    expect(box()?.querySelector('[role="alert"]')?.textContent).toBe(conflict);
    expect(box()?.querySelector('table')).not.toBeNull();
    expect(button('refreshCheck again')).toBeTruthy();

    await push(domain({ status: 'error', problem: 'caa', record: null, message: 'A CAA record of kopi.example stops Cloudflare from issuing the certificate.' }));
    expect(steps()[2]).toBe('bad:Issuing certificate');
    await push(domain({ status: 'error', problem: 'in-use', record: null, message: 'kopi.example is already connected to another Cloudflare Pages project.' }));
    expect(steps()[0]).toBe('bad:Not attached');
  });

  it('says what the server refused, and never checks twice at once', async () => {
    await serve({ builds: [liveBuild()], domains: [domain()] });
    await mount(<Deploy />);
    api.on('POST', `/api/sites/${site}/domain/check`, () => answer(409, { error: 'Connect Cloudflare in Integrations first: an API token with Cloudflare Pages: Edit and the Account ID.' }));
    const b = button('refreshCheck again');
    await act(async () => { b?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); b?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await settle();
    expect(api.to('POST', `/api/sites/${site}/domain/check`)).toHaveLength(1);
    expect(st().snackMsg).toMatchObject({ msg: 'Connect Cloudflare in Integrations first: an API token with Cloudflare Pages: Edit and the Account ID.', icon: 'error' });
    expect(steps()[1]).toBe('now:Waiting for DNS');
  });

  it('has no button for a viewer, nor while Cloudflare is not connected', async () => {
    await serve({ builds: [liveBuild()], domains: [domain()] });
    await as('viewer');
    await mount(<Deploy />);
    expect(box()?.querySelector('table')).not.toBeNull();
    expect($$('button', box()!).filter(x => /Check again|Connect domain/.test(x.textContent ?? ''))).toEqual([]);
    await as('admin');
    await change(() => useStore.setState(d => { d.live.ints.cf = cloudflareWire(false); delete d.live.domains[site]; }));
    expect(box()?.querySelector('.web-dom-msg')?.textContent).toBe('kopi.example is not connected yet. Connect Cloudflare in Integrations to attach it.');
    expect($$('button', box()!).filter(x => /Check again|Connect domain/.test(x.textContent ?? ''))).toEqual([]);
  });
});

describe('domain state in the store and on Sites', () => {
  it('keeps the newest record and ignores one for a domain the site no longer has', () => {
    const s = { live: { domains: {} as Record<string, DomainWire> } };
    const first = domain({ updatedAt: 10 }), older = domain({ status: 'none', updatedAt: 5 }), newer = domain({ status: 'cert', updatedAt: 11 });
    liveDomainTo(s, first); liveDomainTo(s, older);
    expect(s.live.domains[site]?.status).toBe('dns');
    liveDomainTo(s, newer);
    expect(s.live.domains[site]?.status).toBe('cert');
    expect(domainOf(s.live.domains, { id: site, domain: 'Kopi.example' })?.status).toBe('cert');
    expect(domainOf(s.live.domains, { id: site, domain: 'teh.example' })).toBeUndefined();
    expect(domainOf(s.live.domains, { id: other, domain: 'masak.example' })).toBeUndefined();
    expect([undefined, domain({ status: 'none' }), domain(), domain({ status: 'cert' }), domain({ status: 'live' })].map(domainStep)).toEqual([0, 0, 1, 2, 3]);
    expect([undefined, domain(), domain({ dnsBy: 'meridian' }), domain({ status: 'cert' }), domain({ status: 'error' }), domain({ status: 'live' })].map(domainNote))
      .toEqual(['', 'Domain: add the DNS record', 'Domain: waiting for DNS', 'Domain: issuing certificate', 'Domain needs attention', '']);
  });

  it('notes the domain under the status in Sites, and the remove dialog says what stays at Cloudflare', async () => {
    await serve({ builds: [liveBuild()], domains: [domain()] });
    await mount(<SitesTable />);
    const row = $$('tbody tr').find(tr => tr.textContent?.includes('kopi.example'));
    expect(row?.querySelector('td[data-label="Status"]')?.textContent).toBe('Being set upDomain: add the DNS record');
    const otherRow = $$('tbody tr').find(tr => tr.textContent?.includes('masak.example'));
    expect(otherRow?.querySelector('td[data-label="Status"]')?.textContent).toBe('Being set up');
    await change(() => st().openConfirm(`site:${site}`));
    expect(st().confirm?.body).toContain('Its Cloudflare Pages project, domain and DNS records are not deleted');
    await change(() => st().closeConfirm());
    /* Demo mode has no Cloudflare: the sentence is not there. */
    await change(() => useStore.setState(d => { d.sample = true; }));
    await change(() => st().openConfirm(`site:${st().sites[0]!.id}`));
    expect(st().confirm?.body).not.toContain('Cloudflare');
  });
});
