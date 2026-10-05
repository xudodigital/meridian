/* Website builds and photos in the store: the "Last deploy" text, the order of answers and events, what is saved in
   the sites document, and the media paths the dashboard reads photos from. */
import { describe, expect, it } from 'vitest';
import { buildWire, photoWire } from './buildFixtures';
import { deployText, siteBuilds } from './builds';
import { photoSrc, photoSrcSet } from './buildsApi';
import { liveBuildTo } from './liveBuilds';
import { serverFactsTo } from './serverFacts';
import { waitN, waitingBuilds } from './rules';
import { pipeData } from '@/views/workspace/helpers';
import { makeEmptyState, makeState } from './testing';
import type { AppState, Site } from './types';
import { docOf } from './workspace';

const site = (id: string, domain: string): Site => ({
  id, domain, country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Coffee', status: 'live', access: 'pending', checked: '—', deploy: 'Never', silos: [], spend: 0, clicks: 0, tok28: 0,
});
const withSite = (): AppState => { const s = makeEmptyState(); s.sites = [site('s1', 'kopi.example')]; return s; };

describe('the last deploy of a site', () => {
  it('is the live version and when it went live, else an approved one, else never', () => {
    expect(deployText([])).toBe('Never');
    expect(deployText([buildWire(1, 's1', 'kopi.example', 1), buildWire(2, 's1', 'kopi.example', 2, { review: 'rejected' })])).toBe('Never');
    expect(deployText([buildWire(2, 's1', 'kopi.example', 2, { review: 'approved' }), buildWire(1, 's1', 'kopi.example', 1, { review: 'approved' })])).toBe('v2 approved, not live');
    const live = buildWire(1, 's1', 'kopi.example', 1, { review: 'approved', deploy: 'live', deployedAt: Date.UTC(2026, 9, 3, 4, 20) });
    expect(deployText([buildWire(2, 's1', 'kopi.example', 2, { review: 'approved' }), live])).toMatch(/^v1 · 3 Oct, \d\d:20$/);
  });

  it('comes from the builds of that site and domain, and is never saved in the sites document', () => {
    const s = withSite();
    liveBuildTo(s, buildWire(1, 's1', 'kopi.example', 1, { review: 'approved' }));
    liveBuildTo(s, buildWire(2, 's2', 'other.example', 4, { review: 'approved' }));
    liveBuildTo(s, buildWire(3, 's1', 'old.example', 7, { review: 'approved' }));
    expect(siteBuilds(s.live.builds, s.sites[0]!).map(b => b.version)).toEqual([1]);
    expect(s.sites[0]?.deploy).toBe('v1 approved, not live');
    const doc = JSON.stringify(docOf(s, 'sites'));
    expect(doc).not.toContain('deploy');
    expect(doc).toContain('kopi.example');
    /* The Site builds table of Workflows shows each site's newest build. */
    expect(s.mod.factory.rows).toEqual([{ s: 's1', c: ['Approved', 'Static site v1', '5', { pill: 'mut', text: 'Not live' }] }]);
    liveBuildTo(s, buildWire(4, 's1', 'kopi.example', 2, { status: 'work', review: '', step: 'Placing 2 approved articles' }));
    expect(s.mod.factory.rows[0]?.c).toEqual(['Placing 2 approved articles', 'Static site v2', '5', { pill: 'info', text: 'Building', live: true }]);
    expect(s.sites[0]?.deploy).toBe('v1 approved, not live');
    /* A document from before keeps no say over it either. */
    s.sites[0]!.deploy = 'Rolled back to v9';
    serverFactsTo(s);
    expect(s.sites[0]?.deploy).toBe('v1 approved, not live');
  });
});

describe('a build from the server', () => {
  it('keeps the newest change when an answer arrives after a newer event', () => {
    const s = withSite();
    liveBuildTo(s, buildWire(1, 's1', 'kopi.example', 1, { status: 'work', review: '', updatedAt: 200 }));
    liveBuildTo(s, buildWire(1, 's1', 'kopi.example', 1, { status: 'queued', review: '', updatedAt: 100 }));
    expect(s.live.builds[1]?.status).toBe('work');
    liveBuildTo(s, buildWire(1, 's1', 'kopi.example', 1, { updatedAt: 300 }));
    expect(s.live.builds[1]).toMatchObject({ status: 'ready', review: 'waiting' });
  });

  it('is kept aside in demo mode, without touching the sample sites', () => {
    const s = makeState();
    const before = s.sites.map(x => x.deploy);
    liveBuildTo(s, buildWire(1, s.sites[0]!.id, s.sites[0]!.domain, 1, { review: 'approved', deploy: 'live', deployedAt: 1 }));
    expect(s.live.builds[1]?.version).toBe(1);
    expect(s.sites.map(x => x.deploy)).toEqual(before);
  });
});

describe('where the dashboard reads a photo', () => {
  it('is a path on the Meridian server for each stored width', () => {
    const p = photoWire('p1', { file: 'cà-phê-phin-3f9a2c1d' });
    expect(photoSrc(5, p, 960)).toBe('/api/media/articles/5/' + encodeURIComponent('cà-phê-phin-3f9a2c1d-960.jpg'));
    expect(photoSrcSet(5, p)).toBe(`/api/media/articles/5/${encodeURIComponent('cà-phê-phin-3f9a2c1d-960.jpg')} 960w, /api/media/articles/5/${encodeURIComponent('cà-phê-phin-3f9a2c1d-1280.jpg')} 1280w`);
  });

  it('is nothing for a name that is not a stored file', () => {
    for (const file of ['../secret', 'a/b', 'x.jpg?y', 'https://upload.wikimedia.org/x', '']) expect(photoSrc(5, photoWire('p1', { file }), 960)).toBe('');
    expect(photoSrc(5, photoWire('p1', { ext: 'svg' as 'jpg' }), 960)).toBe('');
    expect(photoSrcSet(5, photoWire('p1', { file: '../x' }))).toBe('');
  });
});

describe('builds waiting for approval', () => {
  it('count in "Needs approval" and the deploy gate, inside the site filter, outside demo mode only', () => {
    const s = withSite();
    s.sites.push(site('s2', 'other.example'));
    liveBuildTo(s, buildWire(1, 's1', 'kopi.example', 1));
    liveBuildTo(s, buildWire(2, 's2', 'other.example', 1));
    liveBuildTo(s, buildWire(3, 's1', 'kopi.example', 2, { review: 'approved' }));
    liveBuildTo(s, buildWire(4, 's1', 'kopi.example', 3, { status: 'work', review: '' }));
    expect(waitingBuilds(s.live.builds, s).map(b => b.id)).toEqual([1, 2]);
    expect(waitN(s)).toBe(2);
    expect(pipeData(s).find(c => c.st.id === 'dep')?.n).toBe(2);
    s.siteFilter = 's2';
    expect(waitN(s)).toBe(1);
    /* Demo mode keeps the server's builds aside: only its own sample approvals count. */
    const demo = makeState();
    liveBuildTo(demo, buildWire(9, 'a', 'domain-a.example', 1));
    expect(waitN(demo)).toBe(demo.approvals.length + demo.articles.filter(a => a.status === 'review').length);
  });
});
