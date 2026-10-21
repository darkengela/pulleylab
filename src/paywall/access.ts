/** $5 unlocks one profile and tooth count. The client never chooses the Stripe price. */
export const PRICE_CENTS = 500;
export const ADJUSTMENT_MS = 7 * 24 * 60 * 60 * 1000;
export const GRANT_MS = 12 * 60 * 60 * 1000;
const FIT = new Set(['bore', 'd_shaft', 'd_diameter', 'd_flat', 'clearance']);

export function designKey(p: { profile: string; teeth: number }) {
  return `${p.profile}:${p.teeth}`;
}

export function sameParameters(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** Profile or tooth count is a different design. Bore, D-flat, and clearance are fit adjustments. */
export function fitAdjustmentOnly(base: Record<string, unknown>, next: Record<string, unknown>) {
  if (base.profile !== next.profile || base.teeth !== next.teeth) return false;
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (FIT.has(key)) continue;
    if (base[key] !== next[key]) return false;
  }
  return true;
}

export type PaymentFact = {
  eventId: string;
  eventType: string;
  orderId: string;
  designId: string;
  paymentStatus: string | null;
  amountTotal?: number | null;
  currency?: string | null;
};

export function fulfillmentAction(
  fact: PaymentFact,
  seenEventIds: ReadonlySet<string>,
  entitledOrderIds: ReadonlySet<string>,
): 'grant' | 'fail' | 'ignore' {
  if (seenEventIds.has(fact.eventId)) return 'ignore';
  const paidSession =
    (fact.eventType === 'checkout.session.completed' ||
      fact.eventType === 'checkout.session.async_payment_succeeded') &&
    fact.paymentStatus === 'paid';
  const paidIntent = fact.eventType === 'payment_intent.succeeded' && fact.paymentStatus === 'succeeded';
  if (paidSession || paidIntent) {
    if (fact.amountTotal != null && (fact.amountTotal !== PRICE_CENTS || fact.currency !== 'usd'))
      return 'ignore';
    return entitledOrderIds.has(fact.orderId) ? 'ignore' : 'grant';
  }
  if (
    fact.eventType === 'checkout.session.expired' ||
    fact.eventType === 'checkout.session.async_payment_failed' ||
    fact.eventType === 'payment_intent.payment_failed' ||
    (fact.eventType === 'checkout.session.completed' && fact.paymentStatus !== 'paid')
  )
    return 'fail';
  return 'ignore';
}

export type MemoryState = {
  events: Set<string>;
  orders: Map<string, { status: string; designId: string }>;
  entitlements: { orderId: string; designId: string }[];
};

export function applyPayment(state: MemoryState, fact: PaymentFact) {
  const entitled = new Set(state.entitlements.map((row) => row.orderId));
  const action = fulfillmentAction(fact, state.events, entitled);
  state.events.add(fact.eventId);
  if (action === 'grant') {
    state.entitlements.push({ orderId: fact.orderId, designId: fact.designId });
    const order = state.orders.get(fact.orderId);
    if (order) order.status = 'paid';
  } else if (action === 'fail') {
    const order = state.orders.get(fact.orderId);
    if (order && order.status !== 'paid') order.status = 'failed';
  }
  return action;
}

/** A success-page query never creates an entitlement. Only a stored paid order can. */
export function accessFromStoredOrder(order: { status: string } | null): 'grant' | 'pending' | 'none' {
  if (!order) return 'none';
  if (order.status === 'paid') return 'grant';
  if (order.status === 'pending') return 'pending';
  return 'none';
}

export function checkoutLine(priceId: string) {
  if (!priceId) throw Error('STRIPE_PRICE_ID is not set');
  return { price: priceId, quantity: 1 as const };
}

const CHECKOUT_ENV = ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID'] as const;
const PAYMENT_ENV = [...CHECKOUT_ENV, 'STRIPE_WEBHOOK_SECRET'] as const;

/** Names only. Checkout cannot start until the first three are set. */
export function checkoutBlockedMessage(env: Record<string, string | undefined>) {
  if (CHECKOUT_ENV.every((name) => env[name])) return null;
  const missing = PAYMENT_ENV.filter((name) => !env[name]);
  const list = new Intl.ListFormat('en').format(missing);
  return `Checkout could not start because payments are not configured. Missing ${list}.`;
}

export function accessDecision(input: {
  grantDesignId: string;
  requestedDesignId: string;
  profile: string;
  teeth: number;
  parameters: Record<string, unknown>;
  revisions: Record<string, unknown>[];
  adjustmentDeadline: number;
  current: Record<string, unknown>;
  now: number;
}): { allowed: boolean; revise: boolean; reason?: 'design' | 'adjustment' } {
  if (
    input.grantDesignId !== input.requestedDesignId ||
    input.current.profile !== input.profile ||
    input.current.teeth !== input.teeth
  )
    return { allowed: false, revise: false, reason: 'design' };
  if (sameParameters(input.parameters, input.current)) return { allowed: true, revise: false };
  if (input.revisions.some((revision) => sameParameters(revision, input.current)))
    return { allowed: true, revise: false };
  if (input.now <= input.adjustmentDeadline && fitAdjustmentOnly(input.parameters, input.current))
    return { allowed: true, revise: true };
  return { allowed: false, revise: false, reason: 'adjustment' };
}

export function recoveryDecision(input: {
  email: string;
  codeOk?: boolean;
  hasCode?: boolean;
  sessionEmail?: string | null;
  sessionPaid?: boolean;
  hasSession?: boolean;
}): 'allow' | 'deny' {
  const email = input.email.trim().toLowerCase();
  if (!email) return 'deny';
  if (input.hasCode) return input.codeOk ? 'allow' : 'deny';
  if (input.hasSession && input.sessionPaid && input.sessionEmail?.trim().toLowerCase() === email)
    return 'allow';
  return 'deny';
}
