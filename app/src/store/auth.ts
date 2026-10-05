/* Signing in at page load and staying signed in. bootAuth() asks the server who is signed in (the HttpOnly cookie is
   sent by the browser), or whether no account exists yet. While the person is active the page tells the server now and
   then (POST /api/auth/touch), so the idle sign-out chosen in Settings counts real use of the page, not requests.
   An answer saying the session ended signs the page out with a note. */
import { useEffect } from 'react';
import { authApi } from './authApi';
import { ApiError, setAuthHandlers } from './serverApi';
import { lastActivity, useStore } from './store';
import { dropLegacyKeys } from './storage';

export const ENDED_NOTE = 'Your session ended. Sign in again.';
/** How often an active page tells the server it is in use. */
export const TOUCH_MS = 20_000;

/* Whether the server can email a reset link, as its last status answer said. The sign-in screen reads it to choose
   between "Forgot your password?" by email and asking an admin. */
let emailReset = { on: false, at: 0 };
const EMAIL_RESET_FRESH_MS = 5000;
const noteEmailReset = (st: { resetByEmail?: boolean }) => { emailReset = { on: st.resetByEmail === true, at: Date.now() }; };
/** What the last status answer said (false until the server was asked). */
export const resetByEmailKnown = (): boolean => emailReset.on;
/** Asks the server again unless it was asked a moment ago (page load asks just before the sign-in screen shows). */
export async function checkResetByEmail(): Promise<boolean> {
  if (Date.now() - emailReset.at < EMAIL_RESET_FRESH_MS) return emailReset.on;
  try { noteEmailReset(await authApi.status()); } catch { /* the last answer stands */ }
  return emailReset.on;
}

setAuthHandlers({
  ended: () => { if (useStore.getState().session) useStore.getState().signOut(ENDED_NOTE, false); },
  /* Settings now require 2-step verification and this person has not set it up: ask the server and show the setup. */
  enroll: () => { void refreshMe(); },
});

/** Asks the server who is signed in. Sets the session, or the screen to show without one. */
export async function bootAuth(): Promise<void> {
  dropLegacyKeys();
  try {
    const st = await authApi.status();
    noteEmailReset(st);
    if (st.me) useStore.getState().signIn(st.me);
    else useStore.setState(d => { d.auth = st.setup ? 'setup' : 'signin'; });
  } catch (e) {
    useStore.setState(d => { d.auth = e instanceof ApiError && e.status !== 0 && e.status < 500 ? 'signin' : 'offline'; });
  }
}

/** The server's current answer about the signed-in person (after a role change, 2-step setup, a rename elsewhere). */
export async function refreshMe(): Promise<void> {
  if (!useStore.getState().session) return;
  try { useStore.getState().setMe(await authApi.me()); } catch { /* an ended session is handled by the API layer */ }
}

/** Mount once (App does): boot, then the heartbeat while the person is active. */
export function useAuth(): void {
  useEffect(() => { void bootAuth(); }, []);
  useEffect(() => {
    let last = Date.now();
    const id = setInterval(() => {
      const s = useStore.getState();
      if (!s.session || lastActivity() <= last) return;
      last = Date.now();
      void authApi.touch().catch(() => undefined);
    }, TOUCH_MS);
    return () => clearInterval(id);
  }, []);
}
