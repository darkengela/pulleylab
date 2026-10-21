import Stripe from 'stripe';
import { validate } from '../src/cad/parameters.js';
import { checkoutBlockedMessage, checkoutErrorMessage, checkoutLine } from '../src/paywall/access.js';
import { sql } from './db.js';

function originOf(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

export async function POST(request: Request) {
  const blocked = checkoutBlockedMessage(process.env);
  if (blocked) return Response.json({ error: blocked }, { status: 503 });
  const secret = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secret || !priceId)
    return Response.json(
      { error: 'Checkout could not start because payments are not configured.' },
      { status: 503 },
    );
  let body: { parameters?: unknown; price?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  let parameters;
  try {
    parameters = validate(body.parameters);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    const db = sql();
    const designId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    await db('INSERT INTO designs (id, profile, teeth, parameters) VALUES ($1, $2, $3, $4::jsonb)', [
      designId,
      parameters.profile,
      parameters.teeth,
      JSON.stringify(parameters),
    ]);
    await db('INSERT INTO orders (id, design_id, status) VALUES ($1, $2, $3)', [
      orderId,
      designId,
      'pending',
    ]);
    const stripe = new Stripe(secret);
    const origin = originOf(request);
    const line = checkoutLine(priceId);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [line],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=canceled`,
      client_reference_id: orderId,
      metadata: { design_id: designId, order_id: orderId },
      payment_intent_data: { metadata: { design_id: designId, order_id: orderId } },
      customer_creation: 'always',
    });
    await db('UPDATE orders SET stripe_session_id = $1 WHERE id = $2', [session.id, orderId]);
    if (!session.url) return Response.json({ error: 'Checkout could not be started.' }, { status: 502 });
    return Response.json({ url: session.url });
  } catch (error) {
    const message = checkoutErrorMessage(error);
    console.error('create-checkout failed', message);
    return Response.json({ error: message }, { status: 502 });
  }
}
