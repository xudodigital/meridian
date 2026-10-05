// Unit tests for the pieces under Insights data: what may be sent to DataForSEO, matching a site to an Analytics
// property, Google's refusals in words, and how a keyword is compared with Search Console queries.
// Run with `npm run test:server`.
import { TEST_DATA } from './fixtures/temp-data.ts';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';

after(() => rmSync(TEST_DATA, { recursive: true, force: true }));

const { cleanKeyword, locationOf } = await import('./dataforseo.ts');
const { propertyOf } = await import('./ga4.ts');
const { QuotaError, googleError } = await import('./google.ts');
const { addDays } = await import('./metrics.ts');
const { queryOf } = await import('./rank.ts');

describe('keywords sent to DataForSEO', () => {
  it('are lower case, without the symbols Google Ads refuses, and within its limits', () => {
    assert.equal(cleanKeyword('  Cà Phê   Sữa Đá? '), 'cà phê sữa đá');
    assert.equal(cleanKeyword('cold brew (1:8)'), 'cold brew 1 8');
    assert.equal(cleanKeyword('กาแฟเย็น'), 'กาแฟเย็น', 'combining marks of other scripts stay');
    assert.equal(cleanKeyword("barista's c++ & c# guide"), "barista's c++ & c# guide");
    assert.equal(cleanKeyword('coffee ☕ near me'), null, 'an emoji cannot be sent');
    assert.equal(cleanKeyword('a'.repeat(81)), null);
    assert.equal(cleanKeyword('one two three four five six seven eight nine ten eleven'), null);
    assert.equal(cleanKeyword('?!'), null);
  });
  it('are asked for in the site\'s country: by code when known, else by name', () => {
    assert.deepEqual(locationOf({ cc: 'vn', country: 'Vietnam' }), { location_code: 2704 });
    assert.deepEqual(locationOf({ cc: 'US', country: 'United States' }), { location_code: 2840 });
    assert.deepEqual(locationOf({ cc: 'XX', country: 'Atlantis' }), { location_name: 'Atlantis' });
    assert.equal(locationOf({ cc: '', country: ' ' }), null);
  });
});

describe('Analytics property of a site', () => {
  const list = [
    { id: 'properties/1', name: 'Kopi', account: 'A', hosts: ['kopi.example'] },
    { id: 'properties/2', name: 'Teh', account: 'A', hosts: ['teh.example', 'blog.teh.example'] },
    { id: 'properties/3', name: 'App', account: 'B', hosts: [] },
  ];
  it('is matched by the host of a web stream, ignoring www and case; a person\'s choice wins', () => {
    assert.deepEqual(propertyOf({ id: 's1', domain: 'WWW.Kopi.example' }, list, {}), { property: 'properties/1', name: 'Kopi', auto: true });
    assert.deepEqual(propertyOf({ id: 's2', domain: 'blog.teh.example' }, list, {}), { property: 'properties/2', name: 'Teh', auto: true });
    assert.equal(propertyOf({ id: 's3', domain: 'susu.example' }, list, {}), null);
    assert.equal(propertyOf({ id: 's3', domain: 'example' }, list, {}), null, 'a part of a host is not a match');
    assert.deepEqual(propertyOf({ id: 's1', domain: 'kopi.example' }, list, { s1: 'properties/3' }), { property: 'properties/3', name: 'App', auto: false });
    /* A chosen property the account can no longer read falls back to the match. */
    assert.deepEqual(propertyOf({ id: 's1', domain: 'kopi.example' }, list, { s1: 'properties/9' }), { property: 'properties/1', name: 'Kopi', auto: true });
  });
});

describe('a refusal from a Google data API', () => {
  it('tells a used-up quota from a removed sign-in, an API that is off and a missing permission', () => {
    const quota = googleError('Search Console', 'Search Console API', 403, { error: { code: 403, message: 'Quota exceeded', errors: [{ reason: 'quotaExceeded' }] } });
    assert.ok(quota instanceof QuotaError);
    assert.ok(googleError('Google Analytics', 'Google Analytics Data API', 429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'x' } }) instanceof QuotaError);
    const gone = googleError('Search Console', 'Search Console API', 401, {});
    assert.deepEqual([gone instanceof QuotaError, gone.status, gone.message], [false, 401, 'Google access was removed or has expired. Connect with Google again.']);
    assert.equal(googleError('Google Analytics', 'Google Analytics Data API', 403, { error: { status: 'PERMISSION_DENIED', message: 'Google Analytics Data API has not been used in project 1 before or it is disabled.' } }).message, 'Turn on the Google Analytics Data API in Google Cloud, then refresh.');
    assert.equal(googleError('Search Console', 'Search Console API', 403, { error: { message: 'User does not have sufficient permission for site.' } }).message, 'Search Console does not let this Google account read it: User does not have sufficient permission for site.');
    assert.equal(googleError('Search Console', 'Search Console API', 500, {}).message, 'Search Console answered 500.');
  });
});

describe('dates and queries', () => {
  it('adds days across months and years, and compares keywords as Search Console reports queries', () => {
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2025-12-31', 1), '2026-01-01');
    assert.equal(addDays('2026-10-04', -27), '2026-09-07');
    assert.equal(queryOf('  Cà Phê   SỮA đá '), 'cà phê sữa đá');
    assert.equal(queryOf('Café'), 'café', 'composed like the query Google reports');
  });
});
