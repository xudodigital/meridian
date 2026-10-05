/* Test helpers. The tests written against the prototype expect its sample data, so they run in demo mode:
   makeState() builds a seeded state object and resetStore() puts the real store in that mode. The app itself starts
   empty; pass `false` to resetStore() to test that. meFor() is the server's answer for a signed-in test person. */
import { createEmpty } from './empty';
import { seeded } from './rules';
import { createSeed } from './seed';
import { sessionOf } from './session';
import { resetTo, useStore } from './store';
import type { AppState, AuthSession, Me, Role } from './types';

export const T0 = Date.UTC(2026, 9, 2, 9, 0, 0);

/** The name a test session signs in under, per role. */
export const TEST_NAMES: Readonly<Record<Role, string>> = { admin: 'Dana Admin', editor: 'Eli Editor', reviewer: 'Linh Reviewer', viewer: 'Vic Viewer' };

/** What the server answers for a signed-in test person (GET /api/auth/me). A reviewer works on site "a". */
export function meFor(role: Role, name: string = TEST_NAMES[role], email: string = role + '@example.com', over: Partial<Me> = {}): Me {
  const ids: Record<Role, string> = { admin: '1', editor: '2', reviewer: '3', viewer: '4' };
  return { id: ids[role], name, email, role, site: role === 'reviewer' ? 'a' : null, created: T0, disabled: false, twofa: false, mustEnroll: false, ...over };
}
/** The store's session for a test person. */
export const sessionFor = (role: Role, name?: string, email?: string): AuthSession => sessionOf(meFor(role, name, email));

/** A complete, plain AppState (no store, no DOM) in demo mode, built from the seed. */
export function makeState(role: Role | null = 'admin'): AppState {
  return {
    ...createSeed(T0, seeded(7)),
    sample: true,
    session: role ? sessionFor(role) : null,
    auth: 'signin',
    notifRead: [],
    sync: { loaded: false, error: '' },
    loginNote: '', siteFilter: 'all', pg: {}, autoPub: 0, keyWarned: false,
    theme: null, snackMsg: null, confirm: null, pop: null, searchOpen: false, navOpen: false, handoff: { seq: 0, pairs: [] },
  };
}

/** The same, outside demo mode: the empty state the app starts from. */
export function makeEmptyState(role: Role | null = 'admin'): AppState {
  const s = makeState(role);
  return { ...s, ...createEmpty(), sample: false };
}

/**
 * Returns the real store to a fresh state: signed out, not connected to a server, and seeded with the sample data
 * unless `sample` is false.
 */
export function resetStore(sample: boolean = true): void {
  useStore.setState({ ...useStore.getInitialState(), session: null, auth: 'signin' }, true);
  useStore.setState(d => { resetTo(d, sample); });
}
