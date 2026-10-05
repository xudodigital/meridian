import { describe, expect, it } from 'vitest';
import { makeEmptyState, makeState } from '@/store/testing';
import type { BuildWire, KwRequest } from '@/store/types';
import { sceneModel, type SceneKind } from './model';

const records = (kind: SceneKind, s: ReturnType<typeof makeState>) => sceneModel(kind, s).stages.flatMap(x => x.records);
const request = (id: number, site: string, st: KwRequest['st']): KwRequest => ({ id, site, st, topic: `Topic ${id}`, goal: '', t: new Date(0) });
const build = (id: number, over: Partial<BuildWire> = {}): BuildWire => ({ id, siteId: 'a', domain: 'domain-a.example', version: id, status: 'ready', step: '', error: '', review: 'approved', reviewNote: '', deploy: '', deployUrl: '', deployError: '', articles: [], pages: 1, files: 1, bytes: 1, by: '', createdAt: 0, startedAt: null, finishedAt: null, decidedBy: '', decidedAt: null, deployedAt: null, tokens: 0, costUsd: 0, previewPath: "", steps: [], updatedAt: 0, ...over });

describe('visual workspace data', () => {
  it('shows no invented records when the server is empty', () => {
    for (const kind of ['research', 'review', 'deploy', 'sites'] as const) expect(records(kind, makeEmptyState())).toEqual([]);
  });
  it('filters requests by site and only animates running requests', () => {
    const s = makeState(); s.siteFilter = 'a';
    s.kwReqs = [request(1, 'a', 'queued'), request(2, 'a', 'work'), request(3, 'b', 'work')];
    expect(records('research', s).map(r => [r.id, r.working])).toEqual([['1', false], ['2', true]]);
  });
  it('restricts reviewer summaries to their assigned site even with an all-sites filter', () => {
    const s = makeState('reviewer');
    s.kwReqs = [request(1, 'a', 'done'), request(2, 'b', 'done')];
    expect(records('research', s).map(r => r.id)).toEqual(['1']);
    expect(records('sites', s).map(r => r.id)).toEqual(['a']);
    expect(records('review', s).length).toBe(s.articles.filter(a => a.s === 'a' && !a.archived).length);
  });
  it('does not count a blocked live site twice and preserves the access reason', () => {
    const s = makeState(); s.sites = [{ ...s.sites[0], status: 'live', access: 'down' }];
    const model = sceneModel('sites', s);
    expect(model.stages.map(x => x.records.length)).toEqual([0, 0, 0, 1]);
    expect(records('sites', s)[0].detail).toContain('Not reachable');
  });
  it('separates build approval from deployment and preserves failed/superseded history', () => {
    const s = makeEmptyState();
    s.live.builds = Object.fromEntries([
      build(1, { status: 'queued', review: '' }), build(2, { status: 'work', review: '' }),
      build(3, { review: 'waiting' }), build(4), build(5, { deploy: 'work' }),
      build(6, { deploy: 'live' }), build(7, { deploy: 'failed', deployError: 'Upload failed' }),
      build(8, { deploy: 'superseded' }),
    ].map(b => [b.id, b]));
    const model = sceneModel('deploy', s);
    expect(model.stages.map(x => x.records.length)).toEqual([2, 1, 2, 1, 2]);
    expect(records('deploy', s).filter(r => r.working).map(r => r.id).sort()).toEqual(['2', '5']);
    expect(records('deploy', s).find(r => r.id === '7')?.detail).toBe('Upload failed');
  });
});
