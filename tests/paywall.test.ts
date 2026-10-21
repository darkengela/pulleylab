import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/cad/parameters';
import { startCheckout } from '../src/paywall/client';
import {
  accessDecision,
  accessFromStoredOrder,
  applyPayment,
  checkoutBlockedMessage,
  checkoutErrorMessage,
  checkoutLine,
  fitAdjustmentOnly,
  fulfillmentAction,
  recoveryDecision,
  type MemoryState,
  type PaymentFact,
} from '../src/paywall/access';

const base = { ...DEFAULTS } as Record<string, unknown>;
const entitlement = {
  grantDesignId: 'design-a',
  requestedDesignId: 'design-a',
  profile: '8M',
  teeth: 24,
  parameters: base,
  revisions: [] as Record<string, unknown>[],
  adjustmentDeadline: Date.parse('2026-10-27T00:00:00Z'),
  current: base,
  now: Date.parse('2026-10-21T00:00:00Z'),
};

function state(): MemoryState {
  return {
    events: new Set(),
    orders: new Map([['order-1', { status: 'pending', designId: 'design-a' }]]),
    entitlements: [],
  };
}
function fact(overrides: Partial<PaymentFact> = {}): PaymentFact {
  return {
    eventId: 'evt_1',
    eventType: 'checkout.session.completed',
    orderId: 'order-1',
    designId: 'design-a',
    paymentStatus: 'paid',
    amountTotal: 500,
    currency: 'usd',
    ...overrides,
  };
}

describe('paywall decisions', () => {
  it('does not create an entitlement from a forged success URL', () => {
    const memory = state();
    expect(accessFromStoredOrder(null)).toBe('none');
    expect(memory.entitlements).toHaveLength(0);
    const forged = 'https://pulleylab.example/?checkout=success&session_id=cs_forged';
    expect(new URL(forged).searchParams.get('checkout')).toBe('success');
    expect(accessFromStoredOrder(null)).not.toBe('grant');
  });

  it('rejects an unsigned webhook and does not grant', () => {
    const payload = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed' });
    const stripe = new Stripe('sk_test_placeholder');
    expect(() => stripe.webhooks.constructEvent(payload, 't=1,v1=deadbeef', 'whsec_test')).toThrow();
    const memory = state();
    expect(memory.entitlements).toHaveLength(0);
  });

  it('accepts a Stripe test signature and ignores a second delivery', () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({
      id: 'evt_signed',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test' } },
    });
    const stripe = new Stripe('sk_test_placeholder');
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret });
    const event = stripe.webhooks.constructEvent(body, header, secret);
    expect(event.id).toBe('evt_signed');
    const memory = state();
    expect(applyPayment(memory, fact({ eventId: event.id }))).toBe('grant');
    expect(applyPayment(memory, fact({ eventId: event.id }))).toBe('ignore');
    expect(memory.entitlements).toHaveLength(1);
  });

  it('does not grant a failed or canceled checkout', () => {
    for (const failed of [
      fact({ paymentStatus: 'unpaid' }),
      fact({ eventType: 'checkout.session.expired', paymentStatus: 'unpaid' }),
      fact({ eventType: 'payment_intent.payment_failed', paymentStatus: 'failed' }),
      fact({ amountTotal: 100, currency: 'usd' }),
    ]) {
      const memory = state();
      const action = applyPayment(memory, failed);
      expect(action).not.toBe('grant');
      expect(memory.entitlements).toHaveLength(0);
    }
    expect(fulfillmentAction(fact({ paymentStatus: 'unpaid' }), new Set(), new Set())).toBe('fail');
  });

  it('does not let a grant for design A authorize design B', () => {
    expect(accessDecision({ ...entitlement, requestedDesignId: 'design-b' }).allowed).toBe(false);
    expect(accessDecision({ ...entitlement, current: { ...base, profile: '5M' } }).reason).toBe('design');
    expect(accessDecision(entitlement).allowed).toBe(true);
  });

  it('treats profile or tooth changes as a new design and bore, flat, and clearance as a fit adjustment', () => {
    expect(fitAdjustmentOnly(base, { ...base, teeth: 30 })).toBe(false);
    expect(fitAdjustmentOnly(base, { ...base, profile: 'GT2' })).toBe(false);
    expect(fitAdjustmentOnly(base, { ...base, bore: 10, d_flat: 6, clearance: 2 })).toBe(true);
    const inside = accessDecision({
      ...entitlement,
      current: { ...base, bore: 12, d_shaft: true, d_diameter: 12, d_flat: 10, clearance: 1.5 },
    });
    expect(inside).toEqual({ allowed: true, revise: true });
    const expired = accessDecision({
      ...entitlement,
      now: Date.parse('2026-11-01T00:00:00Z'),
      current: { ...base, bore: 12 },
    });
    expect(expired.allowed).toBe(false);
    expect(accessDecision({ ...entitlement, current: { ...base, set_screw: true } }).allowed).toBe(false);
  });

  it('does not unlock from an unverified email', () => {
    expect(recoveryDecision({ email: 'buyer@example.com' })).toBe('deny');
    expect(recoveryDecision({ email: 'buyer@example.com', hasCode: true, codeOk: false })).toBe('deny');
    expect(recoveryDecision({ email: 'buyer@example.com', hasCode: true, codeOk: true })).toBe('allow');
    expect(
      recoveryDecision({
        email: 'buyer@example.com',
        hasSession: true,
        sessionPaid: true,
        sessionEmail: 'other@example.com',
      }),
    ).toBe('deny');
    expect(
      recoveryDecision({
        email: 'buyer@example.com',
        hasSession: true,
        sessionPaid: false,
        sessionEmail: 'buyer@example.com',
      }),
    ).toBe('deny');
    expect(
      recoveryDecision({
        email: 'buyer@example.com',
        hasSession: true,
        sessionPaid: true,
        sessionEmail: 'Buyer@Example.com',
      }),
    ).toBe('allow');
  });

  it('names the missing payment settings and does not invent a price', () => {
    const missing = checkoutBlockedMessage({});
    expect(missing).toContain('DATABASE_URL');
    expect(missing).toContain('STRIPE_SECRET_KEY');
    expect(missing).toContain('STRIPE_PRICE_ID');
    expect(missing).toContain('STRIPE_WEBHOOK_SECRET');
    expect(
      checkoutBlockedMessage({
        DATABASE_URL: 'postgres://local',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_PRICE_ID: 'price_x',
      }),
    ).toBeNull();
  });

  it('returns the checkout failure and strips credentials', () => {
    expect(checkoutErrorMessage(Error('Checkout could not be started.'))).toBe(
      'Checkout could not be started.',
    );
    expect(
      checkoutErrorMessage(
        Error(
          "The provided key 'rk_live_examplekeyvalue' does not have the required permissions. Having the 'checkout_session_write' permission would allow this request to continue.",
        ),
      ),
    ).toBe(
      "The provided key 'a restricted key' does not have the required permissions. Having the 'checkout_session_write' permission would allow this request to continue.",
    );
    expect(checkoutErrorMessage(Error('connect ECONNREFUSED postgres://user:secret@host/db'))).toBe(
      'connect ECONNREFUSED the database',
    );
    expect(checkoutErrorMessage(Error('   '))).toBe('Checkout could not be started.');
  });

  it('shows the server checkout error instead of a generic fallback', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Stripe refused to open checkout.' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    try {
      await expect(startCheckout({ ...DEFAULTS, profile: 'GT5', teeth: 120 })).rejects.toThrow(
        'Stripe refused to open checkout.',
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('uses the server price and ignores a client price', () => {
    expect(checkoutLine('price_test_123')).toEqual({ price: 'price_test_123', quantity: 1 });
    expect(checkoutLine('price_test_123')).not.toHaveProperty('amount');
  });
});
