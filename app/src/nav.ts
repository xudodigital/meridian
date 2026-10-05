/* Navigation from anywhere (components, store callbacks, search results) without importing the router,
   which itself imports every view. router.tsx registers the real navigator at start-up. */
import { TITLES, isAliasId } from '@/store/constants';
import { canSee, canSeeTab, unalias } from '@/store/rules';
import { useStore } from '@/store/store';
import type { AliasId, ViewId } from '@/store/types';

type Navigator = (view: ViewId, replace: boolean) => void;
let navigator: Navigator | null = null;
export function setNavigator(fn: Navigator): void { navigator = fn; }

/**
 * The prototype's go(v): opens a view by id, or a tab by its alias ("rank", "audit", "keywords": selects the tab, opens its view).
 * A role that may not open the view gets the prototype's snackbar and stays where it is.
 * Closes the side navigation, the popover and the agent sheet, as a click on a [data-view] control did.
 */
export function go(v: ViewId | AliasId, opts: { replace?: boolean } = {}): void {
  const r = unalias(v); if (!r) return;
  const st = useStore.getState();
  if (st.session && !canSee(st.session, r.view)) { st.snack('Your role cannot open ' + TITLES[r.view] + '.', 'lock'); return; }
  if (isAliasId(v)) {
    if (st.session && !canSeeTab(st.session, v)) { st.snack('Your role cannot open ' + r.alias?.label + '.', 'lock'); return; }
    st.applyAlias(v);
  }
  if (st.navOpen || st.pop || st.agentSheet) useStore.setState(d => { d.navOpen = false; d.pop = null; d.agentSheet = null; });
  navigator?.(r.view, !!opts.replace);
}
