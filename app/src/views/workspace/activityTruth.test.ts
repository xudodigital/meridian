// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { meFor, resetStore } from '@/store/testing';
import { feedRows } from './helpers';

describe('live activity accuracy', () => {
  it('rejects invalid site profiles before adding a site or optimistic activity', () => {
    resetStore(false);
    useStore.getState().signIn(meFor('admin'));
    const before = useStore.getState();
    const profile = { domain: 'kopi.example', country: 12, lang: 'Indonesian', topic: 'x'.repeat(121), status: 'build' as const };
    expect(before.addSite(profile)).toContain('120 characters');
    expect(before.addSite({ ...profile, topic: 'Coffee\nrecipes' })).toContain('one line');
    expect(useStore.getState().sites).toEqual(before.sites);
    expect(useStore.getState().log).toEqual(before.log);
  });

  it('does not turn client notes or pending optimistic entries into completed Office work', () => {
    const t = new Date();
    const confirmed = { t, actor: 'Research', act: 'Finished Editorial strategy', site: 's1', id: 3 };
    const notes = [
      { t, actor: 'Admin', act: 'Added rejected.example', site: 's1', cid: 'pending' },
      { t, actor: 'Admin', act: 'Added rejected.example', site: 's1', id: 2, note: true },
    ];
    expect(feedRows({ sample: false, siteFilter: 'all', log: [...notes, confirmed] }, 10)).toEqual([confirmed]);
    expect(feedRows({ sample: false, siteFilter: 's2', log: [confirmed] }, 10)).toEqual([]);
  });
});
