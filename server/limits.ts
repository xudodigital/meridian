// Protection against guessing and against running up costs. Kept in memory: a restart clears it, which is acceptable
// for a local server.
//
// Sign-in: failed attempts are counted per email. Five within 15 minutes lock that email for 5 minutes, and every
// further lock within a day lasts twice as long (up to an hour). Nothing is locked per client: on this computer every
// browser and every script has the same address, so a lock on it would shut everybody out at once. A client with many
// failures is slowed down instead: each further attempt waits a little longer before it is even looked at.
// Signed-in people confirming their own password or code have their own counter, so a stranger failing sign-ins can
// never lock them out of their account settings.
// Costly actions (sending the report, checks that call other services) have a small allowance per person.

export type Limit = { max: number; windowMs: number; lockMs: number; /** The longest a repeated lock grows to. */ maxLockMs?: number };
/** 5 failures for one email within 15 minutes lock it for 5 minutes; each repeat doubles the lock, up to 1 hour. */
export const PER_EMAIL: Limit = { max: 5, windowMs: 15 * 60_000, lockMs: 5 * 60_000, maxLockMs: 60 * 60_000 };
/** The same for a signed-in person confirming their password or code (keyed on the account, not on what was typed). */
export const PER_ACCOUNT: Limit = { max: 5, windowMs: 15 * 60_000, lockMs: 5 * 60_000, maxLockMs: 60 * 60_000 };
/** Locks stop doubling after this long without a new one. */
const STRIKE_MEMORY_MS = 24 * 60 * 60_000;

type Entry = { fails: number[]; until: number; strikes: number; lastLock: number };

export class Limiter {
  private map = new Map<string, Entry>();
  private limit: Limit;
  constructor(limit: Limit) { this.limit = limit; }

  /** Milliseconds until the key may try again; 0 when it may try now. */
  wait(key: string, now = Date.now()): number {
    const e = this.map.get(key);
    return e && e.until > now ? e.until - now : 0;
  }
  /** Records a failure. Returns true when this failure locked the key. */
  fail(key: string, now = Date.now()): boolean {
    const e = this.map.get(key) ?? { fails: [], until: 0, strikes: 0, lastLock: 0 };
    e.fails = e.fails.filter(t => now - t < this.limit.windowMs);
    e.fails.push(now);
    let locked = false;
    if (e.fails.length >= this.limit.max) {
      if (now - e.lastLock > STRIKE_MEMORY_MS) e.strikes = 0;
      e.until = now + Math.min(this.limit.lockMs * 2 ** e.strikes, this.limit.maxLockMs ?? this.limit.lockMs);
      e.strikes++; e.lastLock = now; e.fails = [];
      locked = true;
    }
    this.map.set(key, e);
    if (this.map.size > 10_000) this.sweep(now);
    return locked;
  }
  /** A success clears the key's failures and its history of locks. */
  clear(key: string): void { this.map.delete(key); }
  private sweep(now: number): void {
    for (const [k, e] of this.map) if (e.until <= now && now - e.lastLock > STRIKE_MEMORY_MS && e.fails.every(t => now - t >= this.limit.windowMs)) this.map.delete(k);
  }
}

export const emailLimiter = new Limiter(PER_EMAIL);
export const accountLimiter = new Limiter(PER_ACCOUNT);

/** The message for a locked email or account. It says nothing about whether the account exists. */
export const lockedMessage = (ms: number): string => {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return `Too many failed attempts. Try again in ${min} minute${min === 1 ? '' : 's'}.`;
};

/* ---------- Slowing a client down ---------- */

/** After this many failed sign-ins from one address within the window, each further attempt is delayed. */
export const SLOW_AFTER = 20;
const SLOW_WINDOW_MS = 15 * 60_000;
const SLOW_STEP_MS = 250;
export const SLOW_MAX_MS = 5000;

export class Slowdown {
  private map = new Map<string, number[]>();
  /** How long this client's next sign-in attempt waits: 0 until SLOW_AFTER failures, then doubling up to SLOW_MAX_MS. */
  delay(key: string, now = Date.now()): number {
    const fails = (this.map.get(key) ?? []).filter(t => now - t < SLOW_WINDOW_MS);
    if (fails.length < SLOW_AFTER) return 0;
    return Math.min(SLOW_STEP_MS * 2 ** Math.min(fails.length - SLOW_AFTER, 10), SLOW_MAX_MS);
  }
  fail(key: string, now = Date.now()): void {
    const fails = (this.map.get(key) ?? []).filter(t => now - t < SLOW_WINDOW_MS);
    fails.push(now);
    this.map.set(key, fails.slice(-200));
    if (this.map.size > 10_000) for (const [k, v] of this.map) if (v.every(t => now - t >= SLOW_WINDOW_MS)) this.map.delete(k);
  }
}
export const clientSlowdown = new Slowdown();

/* ---------- 2-step codes: wrong codes in a row, stored with the account (users.ts) ---------- */

/** This many wrong 2-step codes in a row lock the second step; every wrong code after that doubles the lock. */
export const TOTP_FREE_FAILS = 5;
const TOTP_LOCK_MS = 60_000;
const TOTP_LOCK_MAX_MS = 60 * 60_000;
/** How long the second step is locked after `fails` wrong codes in a row: 0 below the limit, then 1, 2, 4... minutes. */
export const totpLockMs = (fails: number): number =>
  fails < TOTP_FREE_FAILS ? 0 : Math.min(TOTP_LOCK_MS * 2 ** Math.min(fails - TOTP_FREE_FAILS, 10), TOTP_LOCK_MAX_MS);

/* ---------- An allowance for costly actions ---------- */

/** A token bucket: `burst` actions at once, refilled one every `everyMs`. */
export class Bucket {
  private map = new Map<string, { tokens: number; at: number }>();
  private burst: number; private everyMs: number;
  constructor(burst: number, everyMs: number) { this.burst = burst; this.everyMs = everyMs; }
  /** Takes one token. Returns 0 when allowed, else the milliseconds until the next one. */
  take(key: string, now = Date.now()): number {
    const b = this.map.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + (now - b.at) / this.everyMs); b.at = now;
    this.map.set(key, b);
    if (this.map.size > 10_000) for (const [k, v] of this.map) if (now - v.at > this.burst * this.everyMs) this.map.delete(k);
    if (b.tokens < 1) return Math.ceil((1 - b.tokens) * this.everyMs);
    b.tokens -= 1;
    return 0;
  }
}
/** Sending the report, refreshing Search Console figures, access checks and DNS verification: 20 at once, then one every 15 seconds, per person. */
export const costlyActions = new Bucket(20, 15_000);
export const slowDownMessage = (ms: number): string => {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  return `That is a lot at once. Try again in ${sec} second${sec === 1 ? '' : 's'}.`;
};
