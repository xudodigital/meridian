// "Test connection" for each service: a real call with the stored values, and what it means in words.
// A test never changes anything at the service, except Slack, Telegram and email, whose test is a short message.
import { ServiceError, base, call, errorText, short } from './net.ts';
import { sendMail, smtpConfig, SmtpError } from './smtp.ts';
import { googleTest } from './google.ts';
import type { Status } from './integrations.ts';

export type TestResult = { status: Status; msg: string; tail?: string };
export type TestCtx = { by: string; email: string };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const bad = (msg: string): TestResult => ({ status: 'bad', msg });

/** An HTTP status from a service, in words. */
function refused(service: string, status: number, data: unknown): TestResult {
  const own = short(errorText(data));
  if (status === 401 || status === 403) return bad(`${service} refused the key${own ? ': ' + own : '.'}`);
  if (status === 429) return { status: 'warn', msg: `${service} accepted the key but is rate limiting it right now.` };
  return bad(`${service} answered ${status}${own ? ': ' + own : '.'}`);
}

async function openai(v: Record<string, string>): Promise<TestResult> {
  const r = await call<{ data?: { id: string }[] }>('OpenAI', base('OPENAI') + '/v1/models', { headers: { authorization: 'Bearer ' + (v.key ?? '') } });
  if (r.status !== 200) return refused('OpenAI', r.status, r.data);
  return { status: 'ok', msg: `Connected. The key can use ${plural(r.data.data?.length ?? 0, 'model')}.` };
}
async function dataforseo(v: Record<string, string>): Promise<TestResult> {
  const auth = 'Basic ' + Buffer.from(`${v.login ?? ''}:${v.password ?? ''}`).toString('base64');
  type U = { status_code?: number; status_message?: string; tasks?: { status_code?: number; result?: { money?: { balance?: number } }[] }[] };
  const r = await call<U>('DataForSEO', base('DATAFORSEO') + '/v3/appendix/user_data', { headers: { authorization: auth } });
  if (r.status === 401 || r.data.status_code === 40100) return bad('DataForSEO refused the login or API password.');
  if (r.status !== 200 || (r.data.status_code && r.data.status_code !== 20000)) return refused('DataForSEO', r.status, { message: r.data.status_message });
  const balance = r.data.tasks?.[0]?.result?.[0]?.money?.balance;
  if (typeof balance !== 'number') return { status: 'ok', msg: 'Connected.' };
  const money = '$' + balance.toFixed(2);
  return balance < 1 ? { status: 'warn', msg: `Connected, but the balance is ${money}. Top up before research runs out.` } : { status: 'ok', msg: `Connected. Balance ${money}.` };
}
async function cloudflare(v: Record<string, string>): Promise<TestResult> {
  const h = { authorization: 'Bearer ' + (v.token ?? '') };
  const url = (path: string) => base('CLOUDFLARE') + '/client/v4' + path;
  const account = (v.account ?? '').trim();
  if (account && !/^[0-9a-f]{32}$/i.test(account)) return bad('The Account ID does not look right: it is 32 characters of 0-9 and a-f, shown on the account home page in the Cloudflare dashboard.');
  type Cf = { success?: boolean; result?: { status?: string }; errors?: { code?: number; message: string }[]; result_info?: { total_count?: number } };
  /* A token made under My Profile verifies as the user's; one made under an account verifies only at that account. */
  let r = await call<Cf>('Cloudflare', url('/user/tokens/verify'), { headers: h });
  if ((r.status !== 200 || !r.data.success) && account) {
    const a = await call<Cf>('Cloudflare', url(`/accounts/${account}/tokens/verify`), { headers: h });
    if (a.status === 200 && a.data.success) r = a;
  }
  if (r.status !== 200 || !r.data.success) return refused('Cloudflare', r.status === 200 ? 401 : r.status, r.data);
  if (r.data.result?.status && r.data.result.status !== 'active') return bad(`The Cloudflare token is ${r.data.result.status}.`);
  /* Zones only matter for custom domains, so not seeing any is said, not failed. */
  const z = await call<Cf>('Cloudflare', url('/zones?per_page=50'), { headers: h });
  const zones = z.status === 200 && z.data.success ? ` It can see ${plural(z.data.result_info?.total_count ?? 0, 'zone')}.` : ' It cannot see zones, which only matters for custom domains.';
  if (!account) return { status: 'warn', msg: 'Token active.' + zones + ' Add the Account ID to deploy websites to Cloudflare Pages.' };
  const p = await call<Cf>('Cloudflare', url(`/accounts/${account}/pages/projects`), { headers: h });
  if (p.status === 200 && p.data.success) return { status: 'ok', msg: 'Token active. It can reach Cloudflare Pages in this account, so deploys will work.' + zones };
  const code = p.data.errors?.[0]?.code;
  if (code === 7003 || code === 7000) return bad('Cloudflare does not know this Account ID, so deploys will not work. Copy it from the account home page in the Cloudflare dashboard.');
  if (p.status === 401 || p.status === 403) return bad('The token cannot use Cloudflare Pages in this account, so deploys will not work. Give it Account > Cloudflare Pages > Edit, and check the Account ID.');
  const own = short(errorText(p.data));
  return { status: 'warn', msg: `Token active, but Cloudflare Pages answered ${p.status}${own ? ': ' + own : ''}, so deploys may not work.` + zones };
}
async function globalping(v: Record<string, string>): Promise<TestResult> {
  type L = { rateLimit?: { measurements?: { create?: { type?: string; limit?: number; remaining?: number } } } };
  const r = await call<L>('Globalping', base('GLOBALPING') + '/v1/limits', { headers: v.token ? { authorization: 'Bearer ' + v.token } : {} });
  if (r.status === 401 || r.status === 403) return bad('Globalping refused the token.');
  if (r.status !== 200) return refused('Globalping', r.status, r.data);
  const c = r.data.rateLimit?.measurements?.create;
  const left = c && typeof c.remaining === 'number' && typeof c.limit === 'number' ? ` ${c.remaining} of ${c.limit} tests left this hour.` : '';
  if (v.token && c?.type === 'ip') return { status: 'warn', msg: 'Globalping did not accept the token, so the public limit applies.' + left };
  return { status: 'ok', msg: (v.token ? 'Connected with a token.' : 'Connected without a token.') + left };
}

/** Posts a message to a Slack incoming webhook. */
export async function slackPost(webhook: string, textMsg: string): Promise<void> {
  let res: Response;
  try { res = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: textMsg }), signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
  catch { throw new ServiceError('Could not reach Slack.'); }
  const body = (await res.text().catch(() => '')).trim();
  if (res.status === 404 || body === 'no_service' || body === 'invalid_token') throw new ServiceError('Slack does not know this webhook. It may have been removed; create a new one.', res.status);
  if (res.status !== 200) throw new ServiceError(`Slack answered ${res.status}${body ? ': ' + short(body, 80) : '.'}`, res.status);
}

/** Sends a message to a Telegram chat. Returns the chat's title, when Telegram gives it. */
export async function telegramSend(token: string, chat: string, textMsg: string): Promise<string> {
  type T = { ok?: boolean; description?: string; result?: { chat?: { title?: string; username?: string; first_name?: string } } };
  const r = await call<T>('Telegram', `${base('TELEGRAM')}/bot${token}/sendMessage`, { body: { chat_id: chat, text: textMsg, disable_web_page_preview: true } });
  if (r.status === 401 || r.status === 404) throw new ServiceError('Telegram refused the bot token.', r.status);
  if (!r.data.ok) {
    const d = r.data.description ?? '';
    if (/chat not found/i.test(d)) throw new ServiceError('Telegram cannot find that chat. Add the bot to the chat and check the chat ID.', r.status);
    throw new ServiceError('Telegram refused the message' + (d ? ': ' + short(d, 120) : '.'), r.status);
  }
  const c = r.data.result?.chat;
  return c?.title || c?.username || c?.first_name || '';
}

const TEST_TEXT = (by: string) => `Meridian test: alerts will arrive here. Sent by ${by}.`;

async function slack(v: Record<string, string>, ctx: TestCtx): Promise<TestResult> {
  await slackPost(v.webhook ?? '', TEST_TEXT(ctx.by));
  return { status: 'ok', msg: 'Connected. A test message was posted to the channel.' };
}
async function telegram(v: Record<string, string>, ctx: TestCtx): Promise<TestResult> {
  const title = await telegramSend(v.token ?? '', v.chat ?? '', TEST_TEXT(ctx.by));
  return { status: 'ok', msg: `Connected. A test message was sent to ${title ? '"' + title + '"' : 'the chat'}.` };
}
async function email(v: Record<string, string>, ctx: TestCtx): Promise<TestResult> {
  await sendMail(smtpConfig(v), { to: [ctx.email], subject: 'Meridian test email', text: `This is a test from Meridian. Reports and alerts by email will be sent from this server.\n\nSent by ${ctx.by}.` });
  return { status: 'ok', msg: `Connected. A test email was sent to ${ctx.email}.` };
}

const TESTS: Record<string, (v: Record<string, string>, ctx: TestCtx) => Promise<TestResult>> = {
  openai, dfs: dataforseo, cf: cloudflare, probe: globalping, slack, tg: telegram, email,
  google: async () => ({ status: 'ok', msg: 'Saved. Connect Search Console or Analytics to check it with Google.' }),
  gsc: v => googleTest('gsc', v), ga4: v => googleTest('ga4', v),
};

/** Runs the test of a service. Never throws: a failure is a result. */
export async function testService(id: string, values: Record<string, string>, ctx: TestCtx): Promise<TestResult> {
  const t = TESTS[id];
  if (!t) return bad('This service has no test.');
  try { return await t(values, ctx); }
  catch (e) {
    if (e instanceof ServiceError || e instanceof SmtpError) return bad(e.message);
    return bad('The test failed: ' + short((e as Error).message, 120));
  }
}
