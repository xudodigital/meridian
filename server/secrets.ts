// Password hashing, random tokens and comparisons. Everything here uses node:crypto only.
// Password material never leaves this module except as a hash string; nothing here logs.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** The rules for a new password: at least 12 and at most 200 characters. Any characters are allowed. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

/** Why a new password cannot be used, or '' when it can. */
export function passwordError(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Use a password of at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use a password of at most ${PASSWORD_MAX} characters.`;
  return '';
}

/* scrypt cost: N = 2^15, r = 8, p = 1 needs 32 MiB, so maxmem is raised above Node's 32 MiB default. About 50-100 ms per hash. */
const COST = { N: 32768, r: 8, p: 1 } as const;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keylen, { ...opts, maxmem: MAXMEM }, (err, key) => err ? reject(err) : resolve(key));
  });
}

/** "scrypt$N$r$p$salt$hash" with a fresh 16-byte salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, COST, KEYLEN);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** A stored hash with the same cost as real ones, used for unknown emails so a sign-in takes the same time either way. */
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword(randomBytes(24).toString('base64')));

/**
 * Checks a password against a stored hash in constant time. A missing or malformed hash is checked against a decoy,
 * so the time taken does not tell whether the account exists.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored || '').split('$');
  const valid = parts.length === 6 && parts[0] === 'scrypt';
  const [, n, r, p, salt, hash] = valid ? parts : (await decoyHash()).split('$');
  const expected = Buffer.from(hash ?? '', 'base64');
  const N = Number(n), R = Number(r), P = Number(p);
  if (!expected.length || ![N, R, P].every(Number.isSafeInteger) || N > 1 << 20 || R > 32 || P > 16) return false;
  const key = await scrypt(password, Buffer.from(salt ?? '', 'base64'), { N, r: R, p: P }, expected.length);
  return timingSafeEqual(key, expected) && valid;
}

/** A random token for a cookie or a link: 32 bytes, base64url. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** SHA-256 in hex. Tokens are stored only as this. */
export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest(), y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}
