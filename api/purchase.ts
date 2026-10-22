import Stripe from 'stripe';
import { attachDecision, claimFromStripeSession, sessionMatchesOrder } from '../src/paywall/access.js';
import { sql } from './db.js';
import { grantPaidOrder } from './fulfill.js';
import type { Account } from './session.js';

export type EntitlementRow = {
  id: string;
  order_id: string;
  design_id: string;
  email: string;
  profile: string;
  teeth: number;
  parameters: unknown;
  adjustment_deadline: string;
  grant_expires_at: string | null;
};

export type SettledPurchase =
  | { status: 'none' }
  | { status: 'pending' }
  | { status: 'paid'; email: string; row: EntitlementRow };

function stripeEmail(session: Stripe.Checkout.Session) {
  return (session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
}

async function paidStripeSession(sessionId: string) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    return await new Stripe(key).checkout.sessions.retrieve(sessionId);
  } catch {
    return null;
  }
}

/** Confirms a stored order with Stripe when the webhook has not written it yet. */
export async function settleCheckoutSession(sessionId: string): Promise<SettledPurchase> {
  const db = sql();
  const orders = (await db(
    'SELECT id, status, design_id, email FROM orders WHERE stripe_session_id = $1',
    [sessionId],
  )) as { id: string; status: string; design_id: string; email: string | null }[];
  const order = orders[0];
  if (!order) return { status: 'none' };
  if (order.status !== 'paid') {
    const session = await paidStripeSession(sessionId);
    if (!session) return { status: order.status === 'pending' ? 'pending' : 'none' };
    const view = {
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
    };
    if (!sessionMatchesOrder(view, { id: order.id, designId: order.design_id })) return { status: 'none' };
    if (claimFromStripeSession(view) !== 'grant')
      return { status: order.status === 'pending' ? 'pending' : 'none' };
    await grantPaidOrder(db, {
      orderId: order.id,
      designId: order.design_id,
      email: stripeEmail(session),
    });
  }
  const rows = (await db('SELECT * FROM entitlements WHERE order_id = $1', [order.id])) as EntitlementRow[];
  const row = rows[0];
  if (!row) return { status: 'pending' };
  let email = String(row.email || '').trim().toLowerCase();
  if (!email) {
    const session = await paidStripeSession(sessionId);
    email = session && session.payment_status === 'paid' ? stripeEmail(session) : '';
    if (email)
      await db(`UPDATE entitlements SET email = $1 WHERE id = $2 AND email = ''`, [email, row.id]);
  }
  return { status: 'paid', email, row: { ...row, email } };
}

/** Links every paid design whose stored receipt email is this verified Google email. */
export async function linkAccountPurchases(account: Account) {
  const db = sql();
  await db(
    `INSERT INTO accounts (google_sub, email) VALUES ($1, $2)
     ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email`,
    [account.sub, account.email],
  );
  await db(
    `UPDATE entitlements
     SET google_sub = $1
     FROM orders
     WHERE entitlements.order_id = orders.id
       AND orders.status = 'paid'
       AND lower(entitlements.email) = $2
       AND entitlements.email <> ''
       AND (entitlements.google_sub IS NULL OR entitlements.google_sub = $1)`,
    [account.sub, account.email],
  );
}

export async function attachSettledPurchase(account: Account, settled: SettledPurchase) {
  if (settled.status !== 'paid') return 'deny' as const;
  const decision = attachDecision({
    orderStatus: 'paid',
    purchaseEmail: settled.email,
    googleEmail: account.email,
    emailVerified: true,
  });
  if (decision !== 'attach') return decision;
  const db = sql();
  await db(
    `UPDATE entitlements SET google_sub = $1 WHERE id = $2 AND (google_sub IS NULL OR google_sub = $1)`,
    [account.sub, settled.row.id],
  );
  return decision;
}

export async function savedDesigns(sub: string) {
  const db = sql();
  return (await db(
    `SELECT e.id, e.design_id, e.profile, e.teeth, e.parameters, e.adjustment_deadline,
            (SELECT r.parameters FROM revisions r
             WHERE r.entitlement_id = e.id
             ORDER BY r.created_at DESC
             LIMIT 1) AS latest
     FROM entitlements e
     JOIN orders o ON o.id = e.order_id
     WHERE e.google_sub = $1 AND o.status = 'paid'
     ORDER BY e.created_at DESC`,
    [sub],
  )) as {
    id: string;
    design_id: string;
    profile: string;
    teeth: number;
    parameters: unknown;
    adjustment_deadline: string;
    latest: unknown;
  }[];
}
