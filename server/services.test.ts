// Unit tests for the pieces under connected services: encryption of secrets, the report schedule, quiet hours,
// the email message and matching a domain to its Search Console property. Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'meridian-unit-'));
process.env.MERIDIAN_DATA = tmp;
after(() => rmSync(tmp, { recursive: true, force: true }));

const vault = await import('./vault.ts');
const { dueAt } = await import('./report.ts');
const { quietNow } = await import('./notify.ts');
const { buildMessage } = await import('./smtp.ts');
const { propertyFor } = await import('./google.ts');
const { putDoc } = await import('./workspace.ts');

describe('vault', () => {
  it('seals with a fresh nonce each time and opens again', () => {
    const a = vault.seal('sk-secret-value'), b = vault.seal('sk-secret-value');
    assert.notEqual(a, b);
    assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(vault.open(a), 'sk-secret-value');
    assert.equal(vault.seal(''), '');
    assert.equal(vault.open(''), '');
  });
  it('refuses a changed value', () => {
    const a = vault.seal('hello world');
    const parts = a.split('.');
    const body = Buffer.from(parts[3]!, 'base64url'); body[0] = body[0]! ^ 1;
    assert.throws(() => vault.open([...parts.slice(0, 3), body.toString('base64url')].join('.')));
    assert.throws(() => vault.open('plain'));
  });
  it('keeps its key in a file only this user can read', () => {
    assert.equal(statSync(join(tmp, 'secret.key')).mode & 0o777, 0o600);
  });
});

describe('report schedule', () => {
  const at = (s: string) => new Date(s);
  it('is due on Monday 08:00, every day 08:00, or the first of the month', () => {
    /* Wednesday 3 Jun 2026, 10:00 local time. */
    const now = at('2026-06-03T10:00:00');
    assert.equal(new Date(dueAt('Every Monday 08:00', now)).toString(), at('2026-06-01T08:00:00').toString());
    assert.equal(new Date(dueAt('Every day 08:00', now)).toString(), at('2026-06-03T08:00:00').toString());
    assert.equal(new Date(dueAt('Every day 08:00', at('2026-06-03T07:59:00'))).toString(), at('2026-06-02T08:00:00').toString());
    assert.equal(new Date(dueAt('First day of the month', now)).toString(), at('2026-06-01T08:00:00').toString());
    assert.equal(new Date(dueAt('First day of the month', at('2026-06-01T07:00:00'))).toString(), at('2026-05-01T08:00:00').toString());
    assert.equal(new Date(dueAt('Every Monday 08:00', at('2026-06-01T07:00:00'))).toString(), at('2026-05-25T08:00:00').toString());
  });
});

describe('quiet hours', () => {
  it('follows Settings: none, nights, or nights and weekends', () => {
    const wedNight = new Date('2026-06-03T23:00:00'), wedDay = new Date('2026-06-03T12:00:00'), satDay = new Date('2026-06-06T12:00:00');
    assert.equal(quietNow(wedNight), false);
    putDoc('settings', 0, { quiet: 'night' }, 1);
    assert.deepEqual([quietNow(wedNight), quietNow(wedDay), quietNow(satDay)], [true, false, false]);
    putDoc('settings', 1, { quiet: 'weekend' }, 1);
    assert.deepEqual([quietNow(wedNight), quietNow(wedDay), quietNow(satDay)], [true, false, true]);
  });
});

describe('email message', () => {
  it('encodes the subject, doubles leading dots and attaches files', () => {
    const m = buildMessage('a@example.com', { to: ['b@example.com'], subject: 'Laporan mingguan — Meridian', text: '.hidden line', attachments: [{ filename: 'r.csv', contentType: 'text/csv', content: 'a,b\n1,2\n' }] });
    assert.match(m, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
    assert.match(m, /^Content-Disposition: attachment; filename="r\.csv"$/m);
    assert.ok(!/^\.[^.]/m.test(m), 'no line starts with a single dot');
    assert.ok(!m.includes('\nBcc'));
  });
});

describe('Search Console property', () => {
  it('prefers the domain property, then URL prefixes, ignoring www', () => {
    const sites = [{ siteUrl: 'https://www.example.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }];
    assert.equal(propertyFor('www.example.com', sites), 'sc-domain:example.com');
    assert.equal(propertyFor('example.com', sites.slice(0, 1)), 'https://www.example.com/');
    assert.equal(propertyFor('other.com', sites), null);
  });
});
