/** $10 is 30 days of unlimited generations and downloads. The client never chooses the Stripe price. */
export const PRICE_CENTS = 1000;
export const ACCESS_MS = 30 * 24 * 60 * 60 * 1000;
export const GRANT_MS = 12 * 60 * 60 * 1000;

/** Older checkouts stored a 7-day fit window. Access is 30 days from the original payment, never shorter. */
export function effectiveAccessDeadline(createdAtMs: number, storedDeadlineMs: number) {
  return Math.max(storedDeadlineMs, createdAtMs + ACCESS_MS);
}

export function designKey(p: { profile: string; teeth: number }) {
  return `${p.profile}:${p.teeth}`;
}

export function sameParameters(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
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

export type CheckoutSessionView = {
  status?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: { order_id?: string; design_id?: string } | null;
};

/**
 * The browser return URL is not payment proof. Grant only when Stripe reports
 * a completed $10 usd session. Canceled and unpaid sessions stay locked.
 */
export function claimFromStripeSession(session: CheckoutSessionView | null): 'grant' | 'none' {
  if (!session?.metadata?.order_id || !session.metadata.design_id) return 'none';
  if (session.status !== 'complete' || session.payment_status !== 'paid') return 'none';
  if (session.amount_total !== PRICE_CENTS || session.currency !== 'usd') return 'none';
  return 'grant';
}

export function sessionMatchesOrder(
  session: CheckoutSessionView | null,
  order: { id: string; designId: string },
) {
  return (
    session?.metadata?.order_id === order.id && session.metadata?.design_id === order.designId
  );
}

const DESIGN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Server-chosen private blob path. A client path is never accepted. */
export function designFilePath(designId: string, kind: string) {
  if (kind !== 'step' && kind !== 'stl') throw Error('Invalid file.');
  if (!DESIGN_ID.test(designId)) throw Error('Invalid design.');
  return `designs/${designId}.${kind}`;
}

/** The caller's design must be the one stored, and the 30-day window must still be open. */
export function authorizeStoredFile(input: {
  ownedDesignId: string;
  requestedDesignId: string;
  accessOpen: boolean;
}): 'allow' | 'deny' {
  if (!input.accessOpen || input.ownedDesignId !== input.requestedDesignId) return 'deny';
  return 'allow';
}

export function checkoutLine(priceId: string) {
  if (!priceId) throw Error('STRIPE_PRICE_ID is not set');
  return { price: priceId, quantity: 1 as const };
}

const CHECKOUT_ENV = ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID'] as const;
const PAYMENT_ENV = [...CHECKOUT_ENV, 'STRIPE_WEBHOOK_SECRET'] as const;

/** Stripe and database failures stay specific. Credentials and connection strings do not. */
export function checkoutErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  const message = raw
    .replace(/(?:rk|sk)_(?:live|test)_[A-Za-z0-9]+/g, 'a restricted key')
    .replace(/whsec_[A-Za-z0-9]+/g, 'a webhook secret')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'the database');
  return message || 'Checkout could not be started.';
}

/** Names only. Checkout cannot start until the first three are set. */
export function checkoutBlockedMessage(env: Record<string, string | undefined>) {
  if (CHECKOUT_ENV.every((name) => env[name])) return null;
  const missing = PAYMENT_ENV.filter((name) => !env[name]);
  const list = new Intl.ListFormat('en').format(missing);
  return `Checkout could not start because payments are not configured. Missing ${list}.`;
}

/** Any profile, tooth count, or fit is included while the payment's 30-day window is open. */
export function accessDecision(input: {
  accessDeadline: number;
  now: number;
}): { allowed: boolean; revise: boolean; reason?: 'expired' } {
  if (input.now <= input.accessDeadline) return { allowed: true, revise: false };
  return { allowed: false, revise: false, reason: 'expired' };
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

/** Both values are required. A client id alone cannot finish the code exchange. */
export function googleAuthConfigured(env: Record<string, string | undefined>) {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

/** Checkout-email recovery stays only while Google sign-in is not configured. */
export function recoveryAvailable(env: Record<string, string | undefined>) {
  return !googleAuthConfigured(env);
}

const CHECKOUT_SESSION = /^cs_[A-Za-z0-9_]{8,200}$/;

export function validCheckoutSessionId(value: unknown) {
  return typeof value === 'string' && CHECKOUT_SESSION.test(value);
}

export const PUBLIC_SITE = 'https://pulleylab.zerocad.ai';
export const GOOGLE_REDIRECT_PATH = '/api/google/callback';

/** The OAuth client has one production redirect. The protected Vercel host is not it. */
export function googleRedirectUriForHost(host: string) {
  const bare = host.split(',')[0]?.trim().toLowerCase() ?? '';
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(bare)) return `http://${bare}${GOOGLE_REDIRECT_PATH}`;
  return `${PUBLIC_SITE}${GOOGLE_REDIRECT_PATH}`;
}

export type GoogleIdentity = { sub: string; email: string };

/**
 * Claims from a Google ID token. The signature is checked before this runs.
 * A typed email, a success URL, or an unverified token does not produce an identity.
 */
export function googleIdentityFromClaims(
  claims: {
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
    email?: unknown;
    email_verified?: unknown;
    sub?: unknown;
    nonce?: unknown;
  },
  clientId: string,
  nowSeconds: number,
  nonce: string,
): GoogleIdentity | null {
  if (!clientId || !nonce) return null;
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return null;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(clientId)) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
  if (claims.email_verified !== true) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return null;
  if (typeof claims.email !== 'string') return null;
  const email = claims.email.trim().toLowerCase();
  if (!email.includes('@') || email.length > 320) return null;
  if (claims.nonce !== nonce) return null;
  return { sub: claims.sub, email };
}

/**
 * A paid Checkout session is saved only to the Google account whose verified
 * email is the Stripe receipt email. Unpaid sessions and a mismatched account do not attach.
 */
export function attachDecision(input: {
  orderStatus: string | null;
  purchaseEmail: string | null;
  googleEmail: string | null;
  emailVerified: boolean;
}): 'attach' | 'deny' {
  if (!input.emailVerified || input.orderStatus !== 'paid') return 'deny';
  const purchase = (input.purchaseEmail ?? '').trim().toLowerCase();
  const google = (input.googleEmail ?? '').trim().toLowerCase();
  if (!purchase || !google || purchase !== google) return 'deny';
  return 'attach';
}
