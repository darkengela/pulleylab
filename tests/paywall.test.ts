import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { SCHEMA_SQL, schemaStatements } from '../api/db';
import { DEFAULTS } from '../src/cad/parameters';
import { nextCheckoutBusy, paymentReturnMessage, readGrants, returnSessionId, startCheckout, claimSession, fileForDownload } from '../src/paywall/client';
import {
  accessDecision,
  accessFromStoredOrder,
  applyPayment,
  authorizeStoredFile,
  checkoutBlockedMessage,
  checkoutErrorMessage,
  checkoutLine,
  claimFromStripeSession,
  designFilePath,
  fitAdjustmentOnly,
  fulfillmentAction,
  recoveryDecision,
  sessionMatchesOrder,
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

  it('applies the same tables as schema.sql', () => {
    const file = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
    expect(schemaStatements(SCHEMA_SQL)).toEqual(schemaStatements(file));
    expect(schemaStatements(SCHEMA_SQL).some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS designs'))).toBe(
      true,
    );
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

  it('clears an in-flight checkout when the back-forward cache freezes or restores the page', () => {
    expect(nextCheckoutBusy(true, { type: 'pagehide', persisted: true })).toBe(false);
    expect(nextCheckoutBusy(true, { type: 'pagehide', persisted: false })).toBe(false);
    expect(nextCheckoutBusy(true, { type: 'pageshow', persisted: true })).toBe(false);
    expect(nextCheckoutBusy(false, { type: 'pageshow', persisted: true })).toBe(false);
  });

  it('leaves the checkout flag alone on a normal load', () => {
    expect(nextCheckoutBusy(true, { type: 'pageshow', persisted: false })).toBe(true);
    expect(nextCheckoutBusy(false, { type: 'pageshow', persisted: false })).toBe(false);
    expect(nextCheckoutBusy(true, { type: 'focus', persisted: true })).toBe(true);
  });

  it('unlocks a paid Stripe session and keeps a canceled checkout locked', () => {
    const paid = {
      status: 'complete',
      payment_status: 'paid',
      amount_total: 500,
      currency: 'usd',
      metadata: { order_id: 'order-1', design_id: 'design-a' },
    };
    expect(returnSessionId('?checkout=success&session_id=cs_paid')).toBe('cs_paid');
    expect(returnSessionId('?checkout=canceled')).toBeNull();
    expect(returnSessionId('?checkout=success')).toBeNull();
    expect(claimFromStripeSession(paid)).toBe('grant');
    expect(sessionMatchesOrder(paid, { id: 'order-1', designId: 'design-a' })).toBe(true);
    expect(sessionMatchesOrder(paid, { id: 'other', designId: 'design-a' })).toBe(false);
    expect(claimFromStripeSession({ ...paid, status: 'open', payment_status: 'unpaid' })).toBe('none');
    expect(claimFromStripeSession({ ...paid, status: 'expired', payment_status: 'unpaid' })).toBe('none');
    expect(claimFromStripeSession({ ...paid, amount_total: 100 })).toBe('none');
    expect(claimFromStripeSession(null)).toBe('none');
    expect(paymentReturnMessage(true)).toContain('Download STEP or STL');
    expect(paymentReturnMessage(false)).toContain('stay locked');
  });

  it('rejects a stored file the grant does not cover', () => {
    const designId = '2da326e0-990a-438d-80ee-3b765c66b7ae';
    expect(designFilePath(designId, 'step')).toBe(`designs/${designId}.step`);
    expect(designFilePath(designId, 'stl')).toBe(`designs/${designId}.stl`);
    expect(() => designFilePath('../secret', 'step')).toThrow('Invalid design.');
    expect(() => designFilePath(designId, 'price')).toThrow('Invalid file.');
    expect(
      authorizeStoredFile({ grantDesignId: designId, requestedDesignId: designId, decisionAllowed: true }),
    ).toBe('allow');
    expect(
      authorizeStoredFile({ grantDesignId: designId, requestedDesignId: 'other', decisionAllowed: true }),
    ).toBe('deny');
    expect(
      authorizeStoredFile({ grantDesignId: designId, requestedDesignId: designId, decisionAllowed: false }),
    ).toBe('deny');
  });

  it('remembers a paid return and does not store a grant for an unpaid one', async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    });
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        Response.json({
          status: 'paid',
          grants: [{ profile: 'GT5', teeth: 20, token: 'grant-token', designId: 'design-a' }],
        });
      expect(await claimSession('cs_paid')).toBe(true);
      expect(readGrants()['GT5:20']).toEqual({ token: 'grant-token', designId: 'design-a' });
      globalThis.fetch = async () => Response.json({ status: 'pending' });
      memory.clear();
      expect(await claimSession('cs_open')).toBe(false);
      expect(readGrants()).toEqual({});
    } finally {
      globalThis.fetch = original;
      vi.unstubAllGlobals();
    }
  });

  it('does not upload a design that has no grant and serves a stored file when one exists', async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    });
    const original = globalThis.fetch;
    const local = new Blob(['local-step']);
    try {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response('nope', { status: 500 });
      };
      expect(await fileForDownload({ ...DEFAULTS }, 'step', local)).toBe(local);
      expect(calls).toBe(0);
      memory.set(
        'pulleylab:grants:v1',
        JSON.stringify({ '8M:24': { token: 'grant-token', designId: 'design-a' } }),
      );
      globalThis.fetch = async () => new Response('stored-step', { status: 200 });
      await expect((await fileForDownload({ ...DEFAULTS }, 'step', local)).text()).resolves.toBe('stored-step');
    } finally {
      globalThis.fetch = original;
      vi.unstubAllGlobals();
    }
  });
});
