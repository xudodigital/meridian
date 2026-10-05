/* Routes: one per entry of NAV (11 views), the tab aliases (redirects that also pick the right tab),
   "/invite/<token>" (accepting an invitation, open without a session), "/reset/<token>" (setting a new password with
   a one-time link, open without a session), "/office" (the Workspace's office on a page of
   its own, without the shell), "/" (redirects to the workspace, or to a legacy #hash of the prototype) and a catch-all. */
import { Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, lazyRouteComponent, createRootRoute, createRoute, createRouter, redirect, useParams, useRouterState, type RouteComponent, type ErrorComponentProps } from '@tanstack/react-router';
import { Callout, ConfirmDialog, Snackbar } from '@/components';
import { setNavigator } from '@/nav';
import { Enroll, Loading } from '@/shell/Enroll';
import { InviteAccept } from '@/shell/InviteAccept';
import { Login } from '@/shell/Login';
import { ResetPassword } from '@/shell/ResetPassword';
import { Shell } from '@/shell/Shell';
import { ALIAS_IDS, isViewId } from '@/store/constants';
import { leaveEdit } from '@/store/editGuard';
import { canSee, homeView, unalias } from '@/store/rules';
import { useStore } from '@/store/store';
import type { AliasId, ViewId } from '@/store/types';
const Activity = lazyRouteComponent(() => import('@/views/Activity'), 'Activity');
const Analytics = lazyRouteComponent(() => import('@/views/Analytics'), 'Analytics');
const Deploy = lazyRouteComponent(() => import('@/views/Deploy'), 'Deploy');
const Integrations = lazyRouteComponent(() => import('@/views/Integrations'), 'Integrations');
const Research = lazyRouteComponent(() => import('@/views/Research'), 'Research');
const Review = lazyRouteComponent(() => import('@/views/Review'), 'Review');
const Settings = lazyRouteComponent(() => import('@/views/Settings'), 'Settings');
const Sites = lazyRouteComponent(() => import('@/views/Sites'), 'Sites');
const Skills = lazyRouteComponent(() => import('@/views/Skills'), 'Skills');
const Team = lazyRouteComponent(() => import('@/views/Team'), 'Team');
const Workspace = lazyRouteComponent(() => import('@/views/Workspace'), 'Workspace');
const OfficeDisplay = lazyRouteComponent(() => import('@/views/workspace/OfficeDisplay'), 'OfficeDisplay');

type ViewPath = `/${ViewId}`;
const pathOf = (v: ViewId): ViewPath => `/${v}`;

/**
 * The frame around every route: an invitation link's page; the signed-out screens (first run, sign-in) without a
 * session; the 2-step setup when Settings require it; "Loading the workspace" until the server's workspace arrived;
 * otherwise the shell with the view inside. The Office page passes the same gates as the Workspace, then shows
 * without the shell.
 */
function Root() {
  const session = useStore(s => s.session);
  const waiting = useStore(s => !s.sample && !s.sync.loaded);
  const seg = useRouterState({ select: s => s.location.pathname.split('/')[1] || '' });
  const office = seg === 'office';
  const view: ViewId = isViewId(seg) ? seg : 'workspace';

  let body: ReactNode;
  if (seg === 'invite' || seg === 'reset') body = <Outlet />;
  else if (!session) body = <Login />;
  else if (session.enroll) body = <Enroll />;
  else if (waiting) body = <Loading />;
  /* Role-based access, exactly as canSee: a view the role may not open falls back to its home view. */
  else if (!canSee(session, view)) body = <Navigate to={pathOf(homeView(session))} replace />;
  else if (office) body = <Suspense fallback={<Loading />}><Outlet /></Suspense>;
  else body = <Shell view={view}><Suspense fallback={<p role="status">Loading this view…</p>}><Outlet /></Suspense></Shell>;
  return <>{body}<ConfirmDialog /><Snackbar /></>;
}

/** Shown in place of a view that threw while rendering, so one broken screen does not blank the whole app. Not in the prototype. */
function ViewError({ error }: ErrorComponentProps) {
  return <Callout icon="error"><b>This screen could not be shown.</b> {error instanceof Error ? error.message : String(error)}</Callout>;
}

const rootRoute = createRootRoute({ component: Root, notFoundComponent: () => <Navigate to="/workspace" replace /> });

const view = <P extends ViewId>(path: P, component: RouteComponent) => createRoute({ getParentRoute: () => rootRoute, path, component, errorComponent: ViewError });
const viewRoutes = [
  view('workspace', Workspace), view('review', Review), view('sites', Sites), view('deploy', Deploy),
  view('research', Research), view('analytics', Analytics), view('activity', Activity),
  view('skills', Skills), view('team', Team), view('integrations', Integrations), view('settings', Settings),
] as const;

/* Ids of tabs (ALIAS): the prototype's merged modules (keywords, seo, gsc, ...) and the screens that became tabs
   (/workflows, /history, /audit, /architecture, /links, /experiments, /rank, /reports). Select the tab, then open the
   view. The role guard in Root still applies to the view the redirect lands on. */
const alias = <P extends AliasId>(path: P) => createRoute({
  getParentRoute: () => rootRoute, path,
  beforeLoad: () => { throw redirect({ to: pathOf(useStore.getState().applyAlias(path)), replace: true }); },
});
const aliasRoutes = ALIAS_IDS.map(a => alias(a));

/* "/" opens the workspace. A prototype link such as /#rank or /#keywords still lands on the right view. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/',
  beforeLoad: () => {
    const hash = typeof location === 'undefined' ? '' : location.hash.slice(1);
    const r = hash ? unalias(hash) : null;
    if (r?.alias) useStore.getState().applyAlias(hash as AliasId);
    throw redirect({ to: pathOf(r ? r.view : 'workspace'), hash: '', replace: true });
  },
});

/** /invite/<token>: open without a session. After the account is made the person lands on their home view. */
function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  return <InviteAccept token={token} onDone={() => { void router.navigate({ to: '/', replace: true }); }} />;
}
const inviteRoute = createRoute({ getParentRoute: () => rootRoute, path: '/invite/$token', component: InvitePage });

/** /reset/<token>: open without a session. Afterwards the person signs in with the new password. */
function ResetPage() {
  const { token } = useParams({ from: '/reset/$token' });
  return <ResetPassword token={token} onDone={() => { void router.navigate({ to: '/', replace: true }); }} />;
}
const resetRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reset/$token', component: ResetPage });

/** /office (OFFICE_PATH in workspace/helpers.ts): the office for a second tab or a wall display. Not in the navigation. */
const officeRoute = createRoute({ getParentRoute: () => rootRoute, path: 'office', component: OfficeDisplay, errorComponent: ViewError });

const routeTree = rootRoute.addChildren([indexRoute, inviteRoute, resetRoute, officeRoute, ...viewRoutes, ...aliasRoutes]);

export const router = createRouter({ routeTree, defaultPreload: false, defaultPendingComponent: Loading, defaultPendingMs: 0, defaultPendingMinMs: 0, scrollRestoration: false });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

/* Opening another view takes the article editor off the screen: unsaved changes there are asked about first. */
setNavigator((v, replace) => leaveEdit(() => { void router.navigate({ to: pathOf(v), replace }); }));

/* Signing out returns to the workspace URL, so the next person starts there (the prototype resets state.view).
   A first visit while signed out keeps its URL: after sign-in the person lands on the view they asked for. */
useStore.subscribe((s, prev) => { if (prev.session && !s.session) void router.navigate({ to: '/workspace', replace: true }); });
