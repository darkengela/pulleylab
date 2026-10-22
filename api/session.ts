import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashGrant } from './grant.js';
import { sql } from './db.js';

export const SESSION_COOKIE = 'pulleylab_session';
export const OAUTH_COOKIE = 'pulleylab_oauth';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;

export type Account = { sub: string; email: string };

export type OAuthPending = {
  state: string;
  verifier: string;
  nonce: string;
  sessionId: string | null;
  exp: number;
};

export function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function requestIsSecure(request: Request) {
  const proto = (request.headers.get('x-forwarded-proto') ?? '').split(',')[0]?.trim();
  return proto === 'https';
}

export function setCookie(name: string, value: string, maxAge: number, secure: boolean) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean) {
  return setCookie(name, '', 0, secure);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newOAuthPending(sessionId: string | null): OAuthPending {
  return {
    state: randomBytes(24).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    sessionId,
    exp: Date.now() + OAUTH_SECONDS * 1000,
  };
}

export function encodeOAuthPending(pending: OAuthPending) {
  return Buffer.from(JSON.stringify(pending)).toString('base64url');
}

export function decodeOAuthPending(value: string | null, state: string | null): OAuthPending | null {
  if (!value || !state) return null;
  try {
    const pending = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as OAuthPending;
    if (!pending.state || !pending.verifier || !pending.nonce || typeof pending.exp !== 'number') return null;
    if (pending.exp < Date.now()) return null;
    if (!safeEqual(pending.state, state)) return null;
    return pending;
  } catch {
    return null;
  }
}

export async function openSession(account: Account) {
  const db = sql();
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db(
    'INSERT INTO auth_sessions (token_hash, google_sub, email, expires_at) VALUES ($1, $2, $3, $4)',
    [hashGrant(token), account.sub, account.email, expires],
  );
  return token;
}

/** The cookie is only a lookup key. The Google subject comes from the stored session. */
export async function currentAccount(request: Request): Promise<Account | null> {
  const db = sql();
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    await db('SELECT 1');
    return null;
  }
  const rows = (await db(
    'SELECT google_sub, email, expires_at FROM auth_sessions WHERE token_hash = $1',
    [hashGrant(token)],
  )) as { google_sub: string; email: string; expires_at: string }[];
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { sub: row.google_sub, email: String(row.email).trim().toLowerCase() };
}

export async function endSession(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !process.env.DATABASE_URL) return;
  const db = sql();
  const rows = (await db('SELECT google_sub FROM auth_sessions WHERE token_hash = $1', [
    hashGrant(token),
  ])) as { google_sub: string }[];
  const sub = rows[0]?.google_sub;
  if (!sub) return;
  await db('DELETE FROM auth_sessions WHERE google_sub = $1', [sub]);
  await db(
    'UPDATE entitlements SET grant_hash = NULL, grant_expires_at = NULL WHERE google_sub = $1',
    [sub],
  );
}
