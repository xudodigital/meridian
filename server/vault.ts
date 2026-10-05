// Encryption for secrets kept in the database: API keys, webhook URLs, passwords for email, Google tokens and
// 2-step verification secrets. AES-256-GCM with a random 12-byte nonce per value.
//
// The key is 32 random bytes in data/secret.key (created on first use, readable by this user only), or the
// MERIDIAN_SECRET_KEY environment variable (base64). The database alone does not reveal any secret: a backup of
// meridian.db is useless for secrets without the key file, and so is a key file without the database.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

const PREFIX = 'v1.';
let cached: Buffer | null = null;

function loadKey(): Buffer {
  if (cached) return cached;
  const env = process.env.MERIDIAN_SECRET_KEY;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('MERIDIAN_SECRET_KEY must be 32 bytes, base64.');
    return (cached = k);
  }
  const file = join(DATA_DIR, 'secret.key');
  if (existsSync(file)) {
    const k = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (k.length !== 32) throw new Error('data/secret.key is damaged: it must hold 32 bytes, base64.');
    return (cached = k);
  }
  const k = randomBytes(32);
  /* "wx" fails when another process created the file first; then that file is used. */
  try { writeFileSync(file, k.toString('base64') + '\n', { mode: 0o600, flag: 'wx' }); }
  catch { return loadKey(); }
  chmodSync(file, 0o600);
  return (cached = k);
}

/** Encrypts a value: "v1.<nonce>.<tag>.<ciphertext>", all base64url. '' stays ''. */
export function seal(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', loadKey(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), body].map(b => b.toString('base64url')).join('.');
}

/** Decrypts a sealed value. Throws when it was changed or sealed with another key. '' stays ''. */
export function open(sealed: string): string {
  if (!sealed) return '';
  if (!isSealed(sealed)) throw new Error('This value is not encrypted.');
  const [iv, tag, body] = sealed.slice(PREFIX.length).split('.').map(p => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', loadKey(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
}

export const isSealed = (v: string): boolean => v.startsWith(PREFIX) && v.split('.').length === 4;

/** A stable value derived from the key, for tokens that must not be guessable but must not change (DNS verification). */
export const derive = (label: string, v: string): string => createHmac('sha256', loadKey()).update(label + '\0' + v).digest('hex');
