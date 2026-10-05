/* localStorage access that never throws (private mode, file://, tests without a DOM). Only per-browser conveniences
   live here: the theme, the workspace view mode, whether the Office page's activity ticker
   is paused. Everything else is on the server. */
export const KEY_WS = 'das-ws';
/** Not in the prototype, which forgot the theme on reload; added so an explicit choice survives. */
export const KEY_THEME = 'das-theme';
/** Retired demo preference. Removed on startup and rejected from older tabs. */
export const KEY_DEMO = 'das-demo';
/** The Office page's activity ticker: '1' when the person paused it in this browser (OfficeTicker.tsx). */
export const KEY_TICKER = 'das-ticker-paused';
/** Pause decorative motion without pausing agents or live data. */
export const KEY_MOTION = 'meridian-motion-paused';
/** Keys of earlier versions, which kept the session and the workspace in the browser. Removed at start-up. */
export const LEGACY_KEYS = ['das-data', 'das-session', 'das-name'] as const;

export function readKey(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
export function writeKey(key: string, value: string | null): void {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage is unavailable */ }
}
/** Removes what earlier versions stored in the browser; that data now lives on the server. */
export function dropLegacyKeys(): void { for (const k of LEGACY_KEYS) writeKey(k, null); }
