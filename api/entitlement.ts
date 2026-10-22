import Stripe from 'stripe';
import { validate, type Parameters } from '../src/cad/parameters.js';
import {
  GRANT_MS,
  accessDecision,
  accessFromStoredOrder,
  claimFromStripeSession,
  sessionMatchesOrder,
} from '../src/paywall/access.js';
import { sql } from './db.js';
import { grantPaidOrder } from './fulfill.js';
import { hashGrant, newGrant } from './grant.js';

type EntitlementRow = {
  id: string;
  order_id: string;
  design_id: string;
  email: string;
  profile: string;
  teeth: number;
  parameters: Parameters;
  adjustment_deadline: string;
  grant_expires_at: string | null;
};

// Soft gate: STEP and STL are still generated in the browser. This route only
// decides whether the browser may save that local file.

async function revisionsFor(id: string) {
  const db = sql();
  const rows = (await db('SELECT parameters FROM revisions WHERE entitlement_id = $1', [id])) as {
    parameters: Parameters;
  }[];
  return rows.map((row) => row.parameters as unknown as Record<string, unknown>);
}

async function mint(row: EntitlementRow) {
  const db = sql();
  const grant = newGrant();
  const expires = new Date(Date.now() + GRANT_MS).toISOString();
  await db('UPDATE entitlements SET grant_hash = $1, grant_expires_at = $2 WHERE id = $3', [
    grant.hash,
    expires,
    row.id,
  ]);
  return {
    profile: row.profile,
    teeth: Number(row.teeth),
    token: grant.token,
    designId: row.design_id,
  };
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL)
    return Response.json({ error: 'Payments are not configured.' }, { status: 503 });
  let body: { grant?: string; designId?: string; parameters?: unknown; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const db = sql();
  if (body.sessionId) {
    const orders = (await db(
      'SELECT id, status, design_id FROM orders WHERE stripe_session_id = $1',
      [body.sessionId],
    )) as { id: string; status: string; design_id: string }[];
    const order = orders[0];
    if (!order) return Response.json({ status: 'none' });
    if (order.status !== 'paid') {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) return Response.json({ status: 'pending' });
      let session: Stripe.Checkout.Session;
      try {
        session = await new Stripe(key).checkout.sessions.retrieve(body.sessionId);
      } catch {
        return Response.json({ status: 'none' });
      }
      const view = {
        status: session.status,
        payment_status: session.payment_status,
        amount_total: session.amount_total,
        currency: session.currency,
        metadata: session.metadata,
      };
      if (!sessionMatchesOrder(view, { id: order.id, designId: order.design_id }))
        return Response.json({ status: 'none' });
      if (claimFromStripeSession(view) !== 'grant')
        return Response.json({ status: order.status === 'pending' ? 'pending' : 'none' });
      await grantPaidOrder(db, {
        orderId: order.id,
        designId: order.design_id,
        email: session.customer_details?.email || session.customer_email,
      });
    }
    const access = accessFromStoredOrder({ status: 'paid' });
    if (access !== 'grant') return Response.json({ status: 'none' });
    const rows = (await db('SELECT * FROM entitlements WHERE order_id = $1', [order.id])) as EntitlementRow[];
    if (!rows.length) return Response.json({ status: 'pending' });
    return Response.json({ status: 'paid', grants: [await mint(rows[0])] });
  }
  if (!body.grant || !body.designId)
    return Response.json({ allowed: false, reason: 'design' });
  let parameters: Parameters;
  try {
    parameters = validate(body.parameters);
  } catch (error) {
    return Response.json({ allowed: false, error: (error as Error).message }, { status: 400 });
  }
  const rows = (await db('SELECT * FROM entitlements WHERE grant_hash = $1', [
    hashGrant(body.grant),
  ])) as EntitlementRow[];
  const row = rows[0];
  if (!row) return Response.json({ allowed: false, reason: 'design' });
  if (!row.grant_expires_at || new Date(row.grant_expires_at).getTime() < Date.now())
    return Response.json({ allowed: false, reason: 'expired' });
  const decision = accessDecision({
    grantDesignId: row.design_id,
    requestedDesignId: body.designId,
    profile: row.profile,
    teeth: Number(row.teeth),
    parameters: row.parameters as unknown as Record<string, unknown>,
    revisions: await revisionsFor(row.id),
    adjustmentDeadline: new Date(row.adjustment_deadline).getTime(),
    current: parameters as unknown as Record<string, unknown>,
    now: Date.now(),
  });
  if (decision.revise)
    await db('INSERT INTO revisions (id, entitlement_id, parameters) VALUES ($1, $2, $3::jsonb)', [
      crypto.randomUUID(),
      row.id,
      JSON.stringify(parameters),
    ]);
  return Response.json({ allowed: decision.allowed, reason: decision.reason });
}
