// Accounts and invitations: rows, the shape the API returns, and the queries. No HTTP here.
import { db } from './db.ts';
import { randomToken, sha256 } from './secrets.ts';
import { isSealed, open, seal } from './vault.ts';

export const ROLES = ['admin', 'editor', 'reviewer', 'viewer'] as const;
export type Role = typeof ROLES[number];
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export type UserRow = {
  id: number; name: string; email: string; role: Role; site: string; pass_hash: string; created_at: number; disabled: number;
  totp_secret: string; totp_pending: string; totp_last_step: number; recovery_hashes: string;
};
export type InviteRow = {
  id: number; token_hash: string; email: string; role: Role; site: string; created_by: number | null; created_at: number; expires_at: number; used_at: number | null;
};

/** How long an invitation link works. */
export const INVITE_DAYS = 7;
export const NAME_MAX = 60;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A name as typed: whitespace collapsed. Why it cannot be used, or '' when it can. */
export const cleanName = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
export function nameError(v: string): string {
  if (!v) return 'Enter your name, for example Dewi Lestari.';
  if (v.length > NAME_MAX) return `Enter a name of at most ${NAME_MAX} characters.`;
  return '';
}
export const cleanEmail = (v: unknown): string => String(v ?? '').trim().toLowerCase().slice(0, 200);
export const emailOk = (v: string): boolean => v.length <= 200 && EMAIL.test(v);

/** What the API says about a person. Never includes the password hash, the 2-step secret or recovery codes. */
export function viewUser(u: UserRow) {
  return {
    id: String(u.id), name: u.name, email: u.email, role: u.role, site: u.site || null, created: u.created_at,
    disabled: !!u.disabled, twofa: !!u.totp_secret,
  };
}
export type UserView = ReturnType<typeof viewUser>;

export function viewInvite(i: InviteRow) {
  return { id: String(i.id), email: i.email, role: i.role, site: i.site || null, created: i.created_at, expires: i.expires_at };
}

const qu = {
  count: db.prepare('SELECT COUNT(*) AS n FROM users'),
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
  list: db.prepare('SELECT * FROM users ORDER BY id'),
  insert: db.prepare('INSERT INTO users (name, email, role, site, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  setName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  setPassword: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
  setRole: db.prepare('UPDATE users SET role = ?, site = ? WHERE id = ?'),
  setDisabled: db.prepare('UPDATE users SET disabled = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM users WHERE id = ?'),
  activeAdmins: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`),
  setPendingTotp: db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?'),
  enableTotp: db.prepare(`UPDATE users SET totp_secret = totp_pending, totp_pending = '', totp_last_step = ?, recovery_hashes = ? WHERE id = ?`),
  clearTotp: db.prepare(`UPDATE users SET totp_secret = '', totp_pending = '', totp_last_step = 0, recovery_hashes = '[]' WHERE id = ?`),
  setTotpStep: db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?'),
  setRecovery: db.prepare('UPDATE users SET recovery_hashes = ? WHERE id = ?'),
};
const qi = {
  insert: db.prepare('INSERT INTO invites (token_hash, email, role, site, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  byHash: db.prepare('SELECT * FROM invites WHERE token_hash = ?'),
  byId: db.prepare('SELECT * FROM invites WHERE id = ?'),
  open: db.prepare('SELECT * FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY id'),
  openFor: db.prepare('SELECT id FROM invites WHERE email = ? COLLATE NOCASE AND used_at IS NULL AND expires_at > ?'),
  use: db.prepare('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?'),
  remove: db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL'),
};

export const userCount = (): number => (qu.count.get() as { n: number }).n;
export const userById = (id: number): UserRow | undefined => qu.byId.get(id) as UserRow | undefined;
export const userByEmail = (email: string): UserRow | undefined => qu.byEmail.get(email) as UserRow | undefined;
export const listUsers = (): UserRow[] => qu.list.all() as UserRow[];
export const activeAdminCount = (): number => (qu.activeAdmins.get() as { n: number }).n;

export function createUser(u: { name: string; email: string; role: Role; site: string; passHash: string }): UserRow {
  const info = qu.insert.run(u.name, u.email, u.role, u.site, u.passHash, Date.now());
  return userById(Number(info.lastInsertRowid))!;
}
export const setName = (id: number, name: string) => qu.setName.run(name, id);
export const setPassword = (id: number, hash: string) => qu.setPassword.run(hash, id);
export const setRole = (id: number, role: Role, site: string) => qu.setRole.run(role, role === 'reviewer' ? site : '', id);
export const setDisabled = (id: number, disabled: boolean) => qu.setDisabled.run(disabled ? 1 : 0, id);
export const removeUser = (id: number) => qu.remove.run(id);

/* 2-step secrets are stored encrypted (vault.ts). A database from before that keeps working: sealTotpSecrets() encrypts
   its secrets when the server starts, and a plain value is still read. */
export const setPendingTotp = (id: number, secret: string) => qu.setPendingTotp.run(seal(secret), id);
const plainSecret = (v: string): string => isSealed(v) ? open(v) : v;
/** The person's 2-step secret (base32), or '' when 2-step verification is off. */
export const totpSecret = (u: UserRow): string => plainSecret(u.totp_secret);
/** The secret being set up, or ''. */
export const totpPending = (u: UserRow): string => plainSecret(u.totp_pending);
/** Encrypts 2-step secrets stored by an older Meridian. Returns how many values it encrypted. */
export function sealTotpSecrets(): number {
  const rows = db.prepare(`SELECT id, totp_secret, totp_pending FROM users WHERE totp_secret <> '' OR totp_pending <> ''`).all() as Pick<UserRow, 'id' | 'totp_secret' | 'totp_pending'>[];
  const put = db.prepare('UPDATE users SET totp_secret = ?, totp_pending = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const a = r.totp_secret && !isSealed(r.totp_secret), b = r.totp_pending && !isSealed(r.totp_pending);
    if (!a && !b) continue;
    put.run(a ? seal(r.totp_secret) : r.totp_secret, b ? seal(r.totp_pending) : r.totp_pending, r.id);
    n += (a ? 1 : 0) + (b ? 1 : 0);
  }
  return n;
}
export const enableTotp = (id: number, step: number, recoveryHashes: string[]) => qu.enableTotp.run(step, JSON.stringify(recoveryHashes), id);
export const clearTotp = (id: number) => qu.clearTotp.run(id);
/** Records the step a code was accepted for. False when another request used that step first. */
export const useTotpStep = (id: number, step: number): boolean => Number(qu.setTotpStep.run(step, id, step).changes) > 0;
export const recoveryHashes = (u: UserRow): string[] => { try { const v: unknown = JSON.parse(u.recovery_hashes); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
export const setRecoveryHashes = (id: number, hashes: string[]) => qu.setRecovery.run(JSON.stringify(hashes), id);

/* ---------- Invitations ---------- */

/** Creates an invitation and returns it with the token, which exists only in this answer (the link). */
export function createInvite(i: { email: string; role: Role; site: string; by: number }): { row: InviteRow; token: string } {
  const token = randomToken(), now = Date.now();
  const info = qi.insert.run(sha256(token), i.email, i.role, i.role === 'reviewer' ? i.site : '', i.by, now, now + INVITE_DAYS * 864e5);
  return { row: qi.byId.get(Number(info.lastInsertRowid)) as InviteRow, token };
}
export const inviteByToken = (token: string): InviteRow | undefined => token ? qi.byHash.get(sha256(token)) as InviteRow | undefined : undefined;
export const openInvites = (): InviteRow[] => qi.open.all(Date.now()) as InviteRow[];
export const hasOpenInvite = (email: string): boolean => !!qi.openFor.get(email, Date.now());
/** Marks the invitation used. False when it was already used or has expired. */
export const useInvite = (id: number): boolean => Number(qi.use.run(Date.now(), id, Date.now()).changes) > 0;
export const revokeInvite = (id: number): boolean => Number(qi.remove.run(id).changes) > 0;
