import Stripe from 'stripe';
import { ADJUSTMENT_MS, fulfillmentAction, type PaymentFact } from '../src/paywall/access.js';
import { sql } from './db.js';

type StripeObject = Record<string, unknown> & {
  metadata?: Record<string, string> | null;
  payment_status?: string | null;
  status?: string | null;
  amount_total?: number | null;
  amount?: number | null;
  currency?: string | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  receipt_email?: string | null;
};

export function factFromEvent(event: {
  id: string;
  type: string;
  data: { object: StripeObject };
}): PaymentFact & { email?: string | null } | null {
  const object = event.data?.object;
  if (!object?.metadata?.order_id || !object.metadata.design_id) return null;
  const email = object.customer_details?.email || object.customer_email || object.receipt_email || null;
  return {
    eventId: event.id,
    eventType: event.type,
    orderId: object.metadata.order_id,
    designId: object.metadata.design_id,
    paymentStatus: object.payment_status ?? object.status ?? null,
    amountTotal: object.amount_total ?? object.amount ?? null,
    currency: object.currency ?? null,
    email,
  };
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key || !process.env.DATABASE_URL)
    return Response.json({ error: 'Payments are not configured.' }, { status: 503 });
  const signature = request.headers.get('stripe-signature');
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw Error('Missing signature');
    event = Stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return Response.json({ error: 'Invalid signature.' }, { status: 400 });
  }
  const fact = factFromEvent(event);
  if (!fact) return Response.json({ received: true });
  const db = sql();
  const seen = await db('SELECT id FROM webhook_events WHERE id = $1', [fact.eventId]);
  if (seen.length) return Response.json({ received: true });
  const orders = (await db('SELECT id, status, design_id FROM orders WHERE id = $1', [
    fact.orderId,
  ])) as { id: string; status: string; design_id: string }[];
  const order = orders[0];
  if (!order || order.design_id !== fact.designId) return Response.json({ received: true });
  const existing = await db('SELECT id FROM entitlements WHERE order_id = $1', [fact.orderId]);
  const action = fulfillmentAction(fact, new Set(), new Set(existing.length ? [fact.orderId] : []));
  const email = (fact.email || '').trim().toLowerCase();
  if (action === 'grant') {
    const designs = (await db('SELECT profile, teeth, parameters FROM designs WHERE id = $1', [
      fact.designId,
    ])) as { profile: string; teeth: number; parameters: unknown }[];
    const design = designs[0];
    await db(
      `INSERT INTO entitlements
        (id, order_id, design_id, email, profile, teeth, parameters, adjustment_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        crypto.randomUUID(),
        fact.orderId,
        fact.designId,
        email,
        design?.profile ?? '',
        design?.teeth ?? 0,
        JSON.stringify(design?.parameters ?? {}),
        new Date(Date.now() + ADJUSTMENT_MS).toISOString(),
      ],
    );
    await db('UPDATE orders SET status = $1, email = COALESCE(NULLIF($2, \'\'), email) WHERE id = $3', [
      'paid',
      email,
      fact.orderId,
    ]);
    if (email)
      await db('UPDATE designs SET email = $1 WHERE id = $2 AND email IS NULL', [email, fact.designId]);
  } else if (action === 'fail') {
    await db('UPDATE orders SET status = $1 WHERE id = $2 AND status <> $3', ['failed', fact.orderId, 'paid']);
  } else if (email) {
    await db(
      `UPDATE entitlements SET email = $1 WHERE order_id = $2 AND email = ''`,
      [email, fact.orderId],
    );
    await db('UPDATE orders SET email = $1 WHERE id = $2 AND (email IS NULL OR email = \'\')', [
      email,
      fact.orderId,
    ]);
  }
  await db('INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [fact.eventId]);
  return Response.json({ received: true });
}
