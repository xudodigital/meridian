// The shared workspace against a real server: versioned documents with conflicts, the audit log (append only, actor
// from the session), read notifications, the event stream that keeps other browsers in sync, and Reset workspace.
// Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, events, member, owner, startServer, type Json, type TestServer } from './testkit.ts';

let s: TestServer;
let admin: Client;
before(async () => { s = await startServer(); admin = await owner(s, 'Dana Owner'); });
after(() => s?.stop());

type Docs = Record<string, { version: number; data: Json | Json[] | null }>;
const docs = async (c: Client) => (await c.get('/api/workspace')).data.docs as Docs;

describe('workspace documents', () => {
  it('start empty at version 0, save with the version they were based on, and refuse a stale write', async () => {
    const d = await docs(admin);
    assert.deepEqual(Object.keys(d).sort(), ['agents', 'notifyPrefs', 'reviewModes', 'schedules', 'settings', 'sites', 'skills']);
    assert.deepEqual(d.sites, { version: 0, data: null });
    const site = { id: 's1', domain: 'kopi.example', country: 'Indonesia' };
    const first = await admin.put('/api/workspace/docs/sites', { version: 0, data: [site] });
    assert.deepEqual(first.data, { version: 1 });
    /* Another browser still at version 0. */
    const stale = await admin.put('/api/workspace/docs/sites', { version: 0, data: [] });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.data, { error: 'Someone else changed this at the same time.', version: 1, data: [site] });
    const second = await admin.put('/api/workspace/docs/sites', { version: 1, data: [site, { id: 's2', domain: 'teh.example' }] });
    assert.deepEqual(second.data, { version: 2 });
    assert.equal(((await docs(admin)).sites!.data as Json[]).length, 2);
  });

  it('checks the shape of what is saved', async () => {
    const put = async (id: string, data: unknown, version = 0) => (await admin.put('/api/workspace/docs/' + id, { version, data })).data.error;
    assert.equal(await put('sites', { not: 'a list' }, 2), 'Expected a list.');
    assert.equal(await put('sites', [{ domain: 'x' }], 2), 'Every item needs an id.');
    assert.equal(await put('sites', [{ id: 'a' }, { id: 'a' }], 2), 'Two items have the same id.');
    assert.equal(await put('settings', { twofa: 'yes' }), 'The 2-step setting must be on or off.');
    assert.equal(await put('settings', { timeout: 'forever' }), 'Unknown sign-out time.');
    assert.equal(await put('reviewModes', { s1: 'none' }), 'Unknown review mode.');
    assert.equal(await put('notifyPrefs', { error: [true] }), 'Unknown alert preference.');
    assert.equal((await admin.put('/api/workspace/docs/nothing', { version: 0, data: [] })).status, 404);
    assert.equal((await admin.put('/api/workspace/docs/sites', { data: [] })).data.error, 'Missing version.');
    assert.equal(await put('sites', [{ id: 'big', x: 'y'.repeat(999_990) }], 2), 'This is too much data to save at once.');
    assert.equal((await admin.put('/api/workspace/docs/sites', { version: 2, data: [{ id: 'big', x: 'y'.repeat(2_000_000) }] })).status, 413);
  });
});

describe('the audit log', () => {
  it('appends under the signed-in person, whatever the entry says, and cannot be edited or deleted', async () => {
    const r = await admin.post('/api/audit', { entries: [{ act: '  Added   kopi.example (Indonesia) ', site: 's1', cid: 'c-1', actor: 'Mallory', by: 'Mallory' }, { act: '' }, 'junk'] });
    assert.equal(r.status, 201);
    const [e] = r.data.entries as Json[];
    /* An entry the app posted is a note: marked, and worded so it cannot pass for one the server wrote. */
    assert.deepEqual({ ...e, id: 0, t: 0 }, { id: 0, t: 0, actor: 'Dana Owner', act: 'Note: Added kopi.example (Indonesia)', site: 's1', note: true, cid: 'c-1' });
    assert.equal((r.data.entries as Json[]).length, 1);
    const forged = await admin.post('/api/audit', { entries: [{ act: 'Approved website v9 of kopi.example', note: false, client: 0 }] });
    assert.equal(((forged.data.entries as Json[])[0] as Json).act, 'Note: Approved website v9 of kopi.example');
    const log = (await admin.get('/api/audit')).data.audit as Json[];
    assert.deepEqual([log[0]!.act, log[0]!.note, log[1]!.act, log[1]!.note], ['Note: Approved website v9 of kopi.example', true, 'Note: Added kopi.example (Indonesia)', true]);
    /* The server's own entries carry no mark. */
    const own = log.find(x => x.act === 'Created the owner account');
    assert.ok(own && own.note === undefined);
    assert.deepEqual((s.db().prepare('SELECT client, COUNT(*) AS n FROM audit_log GROUP BY client ORDER BY client').all() as { client: number; n: number }[]).map(x => x.client), [0, 1]);
    for (const m of ['PUT', 'PATCH', 'DELETE']) assert.equal((await admin.req(m, '/api/audit', {})).status, 405, m);
    assert.equal((await admin.del('/api/audit/1')).status, 404);
  });
});

describe('other browsers', () => {
  it('hear about saved documents, new audit entries and read notifications through the event stream', async () => {
    const editor = await member(s, admin, 'editor', 'eli@example.com', 'Eli Editor');
    const reviewer = await member(s, admin, 'reviewer', 'linh@example.com', 'Linh Reviewer', 's1');
    const v = (await docs(editor)).schedules!.version;
    let reviewerGot: { event: string; data: Json }[] = [];
    const got = await events(admin, async () => {
      reviewerGot = await events(reviewer, async () => {
        assert.equal((await editor.put('/api/workspace/docs/schedules', { version: v, data: [{ id: 'c1', wf: 'Weekly', on: true }] })).status, 200);
        assert.equal((await editor.post('/api/audit', { entries: [{ act: 'Enabled the schedule for "Weekly"', cid: 'e-1' }] })).status, 201);
      });
      assert.equal((await admin.post('/api/notifications/read', { keys: ['article-written:1:5', 42] })).status, 200);
    });
    const ws = got.find(e => e.event === 'workspace');
    assert.deepEqual(ws?.data, { doc: 'schedules', version: v + 1, data: [{ id: 'c1', wf: 'Weekly', on: true }] });
    const audit = got.filter(e => e.event === 'audit').map(e => e.data);
    assert.ok(audit.some(a => a.actor === 'Eli Editor' && a.act === 'Note: Enabled the schedule for "Weekly"' && a.note === true && a.cid === 'e-1'));
    assert.deepEqual(got.find(e => e.event === 'reads')?.data, { keys: ['article-written:1:5'] });
    /* A native reviewer hears nothing of schedules, and does not get the audit log. */
    assert.ok(!reviewerGot.some(e => e.event === 'workspace'));
    assert.ok(!reviewerGot.some(e => e.event === 'audit'));
    assert.deepEqual((await admin.get('/api/workspace')).data.notifRead, ['article-written:1:5']);
    assert.deepEqual((await editor.get('/api/workspace')).data.notifRead, [], 'read state is per person');
  });

  it('get "signed-out" and lose the stream when the session ends', async () => {
    const c = new Client(s.base);
    await c.post('/api/auth/sign-in', { email: 'eli@example.com', password: 'correct horse battery staple' });
    const got = await events(c, async () => { await c.post('/api/auth/sign-out'); });
    assert.ok(got.some(e => e.event === 'signed-out'));
    const r = await fetch(s.base + '/api/events', { headers: { cookie: 'meridian_session=' + c.cookie } });
    assert.equal(r.status, 401);
  });
});

describe('Reset workspace', () => {
  it('is for admins, needs RESET typed, and clears the documents but not accounts or the audit log', async () => {
    const editor = new Client(s.base);
    await editor.post('/api/auth/sign-in', { email: 'eli@example.com', password: 'correct horse battery staple' });
    assert.equal((await editor.post('/api/workspace/reset', { confirm: 'RESET' })).status, 403);
    assert.equal((await admin.post('/api/workspace/reset', { confirm: 'reset' })).data.error, 'Type RESET to confirm.');
    const got = await events(editor, async () => { assert.equal((await admin.post('/api/workspace/reset', { confirm: 'RESET' })).status, 200); });
    assert.ok(got.some(e => e.event === 'reset'));
    const d = await docs(admin);
    assert.ok(Object.values(d).every(x => x.version === 0 && x.data === null));
    const before = Number((s.db().prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n);
    const log = (await admin.get('/api/audit')).data.audit as Json[];
    /* The audit log is kept: the reset is one more entry on top of everything that was there. */
    assert.ok(before > 5 && log.length === before);
    assert.deepEqual({ ...log[0], id: 0, t: 0 }, { id: 0, t: 0, actor: 'Dana Owner', act: 'Reset the workspace: sites, schedules, settings, agent changes and added skills', site: null });
    assert.ok(log.some(x => x.act === 'Created the owner account'));
    assert.equal(((await admin.get('/api/users')).data.users as Json[]).length, 3, 'accounts stay');
  });
});
