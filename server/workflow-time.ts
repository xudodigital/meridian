// When a schedule is due. Pure: no database, no clock of its own (every function takes `now`), so the rules can be
// tested for any time zone and any restart. workflows.ts keeps the state (`seen`, `fired`) and starts the runs.
//
// A schedule names a weekday and an hour on the site's own clock: "Monday 06:00" for a site in Vietnam is Monday
// morning in Vietnam. The zone comes from the site's country (a small table: the zone most people of that country live
// in); a country that is not in the table uses the zone of the computer Meridian runs on.

/** How often: every week, every second week, or once a month (the first such weekday of the month). */
export type Every = 'week' | '2weeks' | 'month';
export const EVERY: readonly Every[] = ['week', '2weeks', 'month'];
/** `weekday` as JavaScript counts it (0 Sunday … 6 Saturday); `hour` 0–23 on the site's clock. */
export type Cadence = { every: Every; weekday: number; hour: number };

/** A run that would start more than this long after its time is skipped instead (the server was not running). */
export const LATE_MS = 6 * 60 * 60_000;
const DAY = 86_400_000;
/** "Every 2 weeks": at least this long after the slot that ran before (13 days, so a clock change never delays it a week). */
const FORTNIGHT_MS = 13 * DAY;
/** How far a slot is searched for: a monthly schedule always has one within this many days. */
const SEARCH_DAYS = 62;

const ZONES: Readonly<Record<string, string>> = {
  ID: 'Asia/Jakarta', VN: 'Asia/Ho_Chi_Minh', TH: 'Asia/Bangkok', MY: 'Asia/Kuala_Lumpur', SG: 'Asia/Singapore', PH: 'Asia/Manila',
  BD: 'Asia/Dhaka', PK: 'Asia/Karachi', IN: 'Asia/Kolkata', LK: 'Asia/Colombo', NP: 'Asia/Kathmandu', MM: 'Asia/Yangon', KH: 'Asia/Phnom_Penh',
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', CN: 'Asia/Shanghai', TW: 'Asia/Taipei', HK: 'Asia/Hong_Kong',
  AE: 'Asia/Dubai', SA: 'Asia/Riyadh', IL: 'Asia/Jerusalem', TR: 'Europe/Istanbul', EG: 'Africa/Cairo', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
  ZA: 'Africa/Johannesburg', MA: 'Africa/Casablanca', GH: 'Africa/Accra',
  GB: 'Europe/London', IE: 'Europe/Dublin', PT: 'Europe/Lisbon', ES: 'Europe/Madrid', FR: 'Europe/Paris', DE: 'Europe/Berlin', IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna', PL: 'Europe/Warsaw', CZ: 'Europe/Prague',
  SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', GR: 'Europe/Athens', RO: 'Europe/Bucharest',
  HU: 'Europe/Budapest', UA: 'Europe/Kyiv', RU: 'Europe/Moscow',
  US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
};

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(tz, f);
  }
  return f;
}
const validZone = (tz: string): boolean => { try { format(tz); return true; } catch { return false; } };

/** The zone of the computer Meridian runs on. */
export const serverZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
/** The time zone a site's schedule runs in: its country's, else `fallback` (the server's). */
export function zoneOf(cc: string, fallback: string = serverZone()): string {
  const tz = ZONES[String(cc || '').trim().toUpperCase()];
  return tz && validZone(tz) ? tz : validZone(fallback) ? fallback : 'UTC';
}

type Wall = { y: number; m: number; d: number; h: number; min: number; s: number };
/** The wall clock in `tz` at the instant `ms`. */
export function wallAt(ms: number, tz: string): Wall {
  const p: Record<string, number> = {};
  for (const x of format(tz).formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year ?? 1970, m: p.month ?? 1, d: p.day ?? 1, h: p.hour ?? 0, min: p.minute ?? 0, s: p.second ?? 0 };
}
/** How far `tz` is ahead of UTC at the instant `ms`, in ms. */
function offsetAt(ms: number, tz: string): number {
  const w = wallAt(ms, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000;
}
/** The instant the wall clock in `tz` shows this date and hour. (An hour a clock change skips gives the hour after it.) */
export function wallToUtc(y: number, m: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

/** The slot on the calendar day `day` (a UTC-midnight stand-in for a local date), or null when that day has none. */
function slotOn(day: number, c: Cadence, tz: string): number | null {
  const d = new Date(day);
  if (d.getUTCDay() !== c.weekday) return null;
  if (c.every === 'month' && d.getUTCDate() > 7) return null;
  return wallToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), c.hour, tz);
}
const localDay = (ms: number, tz: string): number => { const w = wallAt(ms, tz); return Date.UTC(w.y, w.m - 1, w.d); };

/** The newest slot at or before `now` (weekly slots for "every 2 weeks" too), or null. */
export function lastSlot(now: number, c: Cadence, tz: string): number | null {
  const today = localDay(now, tz);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const s = slotOn(today - i * DAY, c, tz);
    if (s !== null && s <= now) return s;
  }
  return null;
}
/** The first slot after `after`, or null. */
export function nextSlot(after: number, c: Cadence, tz: string): number | null {
  const today = localDay(after, tz);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const s = slotOn(today + i * DAY, c, tz);
    if (s !== null && s > after) return s;
  }
  return null;
}

/**
 * What the scheduler remembers of a schedule, stored before a run starts so a restart never fires it twice.
 * `seen`: every slot up to this time is dealt with (it starts at the moment the schedule was made, changed or turned on).
 * `fired`: the slot that last ran or was skipped, for the two-week rhythm; null until the first one.
 */
export type DueState = { seen: number; fired: number | null };

/** A slot that should start now. `late` when it is more than LATE_MS old: it is skipped, and the schedule says so. */
export type Due = { slot: number; late: boolean };
export function dueNow(now: number, c: Cadence, tz: string, st: DueState): Due | null {
  const slot = lastSlot(now, c, tz);
  if (slot === null || slot <= st.seen) return null;
  if (c.every === '2weeks' && st.fired !== null && slot - st.fired < FORTNIGHT_MS) return null;
  return { slot, late: now - slot > LATE_MS };
}
/** When the schedule starts next, after `now`. */
export function nextDue(now: number, c: Cadence, tz: string, st: DueState): number | null {
  let s = nextSlot(Math.max(now, st.seen), c, tz);
  if (s !== null && c.every === '2weeks' && st.fired !== null && s - st.fired < FORTNIGHT_MS) s = nextSlot(s, c, tz);
  return s;
}

/** "Mon 6 Oct, 06:00" on the site's clock, for the notes a schedule shows. */
export function slotText(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch { return new Date(ms).toISOString(); }
}

/** A cadence from a stored schedule, or null when it is not one (an old schedule, or anything odd). */
export function cadenceOf(o: { every?: unknown; weekday?: unknown; hour?: unknown }): Cadence | null {
  const every = EVERY.find(e => e === o.every), weekday = Number(o.weekday), hour = Number(o.hour);
  if (!every || typeof o.weekday !== 'number' || typeof o.hour !== 'number') return null;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { every, weekday, hour };
}
