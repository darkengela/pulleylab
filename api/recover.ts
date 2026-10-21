import Stripe from 'stripe';
import { GRANT_MS, recoveryDecision } from '../src/paywall/access.js';
import { sql } from './db.js';
import { grantHashEquals, hashGrant, newGrant } from './grant.js';

type EntitlementRow = {
  id: string;
  design_id: string;
  profile: string;
  teeth: number;
};

function safeHashEquals(stored: string, code: string) {
  try {
    return grantHashEquals(stored, code);
  } catch {
    return false;
  }
}

async function issueGrants(email: string) {
  const db = sql();
  const rows = (await db(
    'SELECT id, design_id, profile, teeth FROM entitlements WHERE lower(email) = $1',
    [email],
  )) as EntitlementRow[];
  const grants = [];
  const expires = new Date(Date.now() + GRANT_MS).toISOString();
  for (const row of rows) {
    const grant = newGrant();
    await db('UPDATE entitlements SET grant_hash = $1, grant_expires_at = $2 WHERE id = $3', [
      grant.hash,
      expires,
      row.id,
    ]);
    grants.push({
      profile: row.profile,
      teeth: Number(row.teeth),
      token: grant.token,
      designId: row.design_id,
    });
  }
  return grants;
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || !process.env.STRIPE_SECRET_KEY)
    return Response.json({ error: 'Payments are not configured.' }, { status: 503 });
  let body: { email?: string; sessionId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'Enter the checkout email.' }, { status: 400 });
  const db = sql();
  if (body.code) {
    const codes = (await db(
      'SELECT id, code_hash, expires_at, used_at FROM recovery_codes WHERE email = $1 ORDER BY expires_at DESC LIMIT 5',
      [email],
    )) as { id: string; code_hash: string; expires_at: string; used_at: string | null }[];
    const match = codes.find(
      (row) =>
        !row.used_at &&
        new Date(row.expires_at).getTime() > Date.now() &&
        safeHashEquals(row.code_hash, body.code!),
    );
    if (recoveryDecision({ email, hasCode: true, codeOk: Boolean(match) }) !== 'allow' || !match)
      return Response.json({ error: 'That recovery code could not be verified.' }, { status: 403 });
    await db('UPDATE recovery_codes SET used_at = now() WHERE id = $1', [match.id]);
    return Response.json({ grants: await issueGrants(email) });
  }
  if (body.sessionId) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let sessionEmail: string | null = null;
    let sessionPaid = false;
    try {
      const session = await stripe.checkout.sessions.retrieve(body.sessionId);
      sessionPaid = session.payment_status === 'paid';
      sessionEmail = session.customer_details?.email ?? session.customer_email ?? null;
    } catch {
      return Response.json({ error: 'That purchase could not be verified.' }, { status: 403 });
    }
    if (recoveryDecision({ email, hasSession: true, sessionPaid, sessionEmail }) !== 'allow')
      return Response.json({ error: 'That purchase could not be verified.' }, { status: 403 });
    const orders = (await db('SELECT status FROM orders WHERE stripe_session_id = $1', [
      body.sessionId,
    ])) as { status: string }[];
    if (orders[0]?.status !== 'paid')
      return Response.json({ error: 'That purchase could not be verified.' }, { status: 403 });
    return Response.json({ grants: await issueGrants(email) });
  }
  const owned = await db('SELECT id FROM entitlements WHERE lower(email) = $1 LIMIT 1', [email]);
  if (owned.length) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await db(
      'INSERT INTO recovery_codes (id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), email, hashGrant(code), new Date(Date.now() + 15 * 60 * 1000).toISOString()],
    );
  }
  return Response.json({
    ok: true,
    sent: false,
    error: 'A recovery code could not be emailed. Enter the Checkout session id from the payment page.',
  });
}
