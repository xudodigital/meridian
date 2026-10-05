// Unit tests of the security primitives: password hashing, TOTP (RFC 6238 vectors), recovery codes and the sign-in
// limiter. No server needed. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Limiter, lockedMessage } from './limits.ts';
import { hashPassword, passwordError, randomToken, safeEqual, sha256, verifyPassword } from './secrets.ts';
import {
  base32Decode, base32Encode, codeAt, hashRecovery, isRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, stepAt, verifyCode,
} from './totp.ts';

describe('passwords', () => {
  it('hashes with scrypt and a per-user salt, and verifies only the right password', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    assert.match(a, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
    assert.notEqual(a, b, 'two hashes of one password must differ (salt)');
    assert.equal(await verifyPassword('correct horse battery staple', a), true);
    assert.equal(await verifyPassword('correct horse battery stapl', a), false);
    assert.equal(await verifyPassword('', a), false);
  });

  it('refuses a missing or malformed hash without throwing (the decoy path)', async () => {
    for (const stored of [null, undefined, '', 'plain', 'scrypt$1$2$3', 'scrypt$99999999$8$1$AAAA$AAAA', 'md5$x$y$z$a$b']) {
      assert.equal(await verifyPassword('anything at all', stored), false, String(stored));
    }
  });

  it('accepts 12 to 200 characters', () => {
    assert.equal(passwordError('a'.repeat(11)), 'Use a password of at least 12 characters.');
    assert.equal(passwordError('a'.repeat(12)), '');
    assert.equal(passwordError('a'.repeat(200)), '');
    assert.equal(passwordError('a'.repeat(201)), 'Use a password of at most 200 characters.');
    assert.equal(passwordError(undefined), 'Use a password of at least 12 characters.');
  });

  it('makes random tokens and compares in constant time', () => {
    const t = randomToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(t, randomToken());
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('TOTP (RFC 6238, SHA-1)', () => {
  /* The RFC's SHA-1 seed is the ASCII "12345678901234567890"; its 8-digit codes end in these 6 digits. */
  const SEED = base32Encode(Buffer.from('12345678901234567890'));

  it('encodes base32 both ways', () => {
    assert.equal(SEED, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(base32Decode(SEED).toString(), '12345678901234567890');
    assert.equal(base32Decode('gezd gnbv-gy3t'.toUpperCase()).length, 7);
    assert.match(newSecret(), /^[A-Z2-7]{32}$/);
  });

  it('matches the RFC test vectors', () => {
    const vectors: [number, string][] = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];
    for (const [t, code] of vectors) assert.equal(codeAt(SEED, stepAt(t * 1000)), code, String(t));
  });

  it('accepts the current step and one either side, once', () => {
    const now = 1_790_000_000_000, step = stepAt(now);
    assert.equal(verifyCode(SEED, codeAt(SEED, step), now, 0), step);
    assert.equal(verifyCode(SEED, codeAt(SEED, step - 1), now, 0), step - 1);
    assert.equal(verifyCode(SEED, codeAt(SEED, step + 1), now, 0), step + 1);
    assert.equal(verifyCode(SEED, codeAt(SEED, step - 2), now, 0), null);
    assert.equal(verifyCode(SEED, codeAt(SEED, step + 2), now, 0), null);
    /* Already used: the step is not after the last accepted one. */
    assert.equal(verifyCode(SEED, codeAt(SEED, step), now, step), null);
    assert.equal(verifyCode(SEED, ' ' + codeAt(SEED, step).slice(0, 3) + ' ' + codeAt(SEED, step).slice(3), now, 0), step);
    for (const bad of ['', '12345', '1234567', 'abcdef']) assert.equal(verifyCode(SEED, bad, now, 0), null);
  });

  it('builds the otpauth link for the QR code', () => {
    assert.equal(otpauthUri('ABC', 'dewi@example.com'), 'otpauth://totp/Meridian%3Adewi%40example.com?secret=ABC&issuer=Meridian&algorithm=SHA1&digits=6&period=30');
  });

  it('makes ten distinct recovery codes that hash the same however they are typed', () => {
    const codes = newRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
    const c = codes[0]!;
    assert.equal(hashRecovery(c.toUpperCase().replace(/-/g, ' ')), hashRecovery(c));
    assert.equal(isRecoveryCode(c), true);
    assert.equal(isRecoveryCode('123456'), false);
  });
});

describe('sign-in limiter', () => {
  it('locks a key after the maximum failures within the window, and a success clears it', () => {
    const l = new Limiter({ max: 3, windowMs: 1000, lockMs: 5000 });
    l.fail('a', 0); l.fail('a', 10);
    assert.equal(l.wait('a', 20), 0);
    l.fail('a', 20);
    assert.equal(l.wait('a', 20), 5000);
    assert.equal(l.wait('a', 5019), 1);
    assert.equal(l.wait('a', 5020), 0);
    /* Failures outside the window do not add up. */
    l.fail('b', 0); l.fail('b', 1500); l.fail('b', 3000);
    assert.equal(l.wait('b', 3000), 0);
    l.fail('c', 0); l.fail('c', 1); l.clear('c'); l.fail('c', 2);
    assert.equal(l.wait('c', 2), 0);
    assert.equal(lockedMessage(61_000), 'Too many failed attempts. Try again in 2 minutes.');
    assert.equal(lockedMessage(1000), 'Too many failed attempts. Try again in 1 minute.');
  });
});
