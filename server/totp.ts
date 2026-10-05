// 2-step verification: time-based one-time passwords (RFC 6238: HMAC-SHA-1, 6 digits, 30-second steps) and the
// single-use recovery codes. A code is accepted for the current step and one step either side, and never twice.
import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual, sha256 } from './secrets.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32 without padding, as authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Not base32.');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, the RFC's recommendation for SHA-1), base32. */
export const newSecret = (): string => base32Encode(randomBytes(20));

/** The step number of a time in milliseconds. */
export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);

/** The 6-digit code of one step (RFC 4226 HOTP with the step as counter). */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const off = mac[mac.length - 1]! & 15;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Checks a code against the steps around `now`. Returns the step it matched, or null. A step at or before `lastStep`
 * was already used and is refused, so a code cannot be replayed.
 */
export function verifyCode(secret: string, code: string, now: number, lastStep: number): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const cur = stepAt(now);
  let hit: number | null = null;
  /* Every candidate is computed and compared, so the time taken does not depend on which one matches. */
  for (const step of [cur - 1, cur, cur + 1]) if (safeEqual(codeAt(secret, step), c) && step > lastStep) hit = step;
  return hit;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, email: string): string {
  const label = encodeURIComponent('Meridian:' + email);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Meridian&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ---------- Recovery codes ---------- */

const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Ten codes like "k7m2-x9pq-4r", about 50 bits each. Shown once; only their hashes are stored. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = [...b].map(x => RC_ALPHABET[x % RC_ALPHABET.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}`;
  });
}
/** A recovery code as typed: case and separators do not matter. */
export const normRecovery = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecovery = (code: string): string => sha256('meridian-recovery:' + normRecovery(code));
/** Looks like a recovery code rather than a 6-digit code. */
export const isRecoveryCode = (code: string): boolean => normRecovery(code).length === 10 && !/^\d+$/.test(code.trim());
