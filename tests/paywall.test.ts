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
  attachDecision,
  authorizeStoredFile,
  checkoutBlockedMessage,
  checkoutErrorMessage,
  checkoutLine,
  claimFromStripeSession,
  designFilePath,
  effectiveAccessDeadline,
  ACCESS_MS,
  fulfillmentAction,
  googleAuthConfigured,
  googleIdentityFromClaims,
  googleRedirectUriForHost,
  recoveryAvailable,
  recoveryDecision,
  sessionMatchesOrder,
  validCheckoutSessionId,
  type MemoryState,
  type PaymentFact,
} from '../src/paywall/access';
import { verifyGoogleIdToken } from '../api/google-token';
import { createSign, generateKeyPairSync, type JsonWebKey } from 'node:crypto';

const base = { ...DEFAULTS } as Record<string, unknown>;

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
    amountTotal: 1000,
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
      fact({ amountTotal: 500, currency: 'usd' }),
    ]) {
      const memory = state();
      const action = applyPayment(memory, failed);
      expect(action).not.toBe('grant');
      expect(memory.entitlements).toHaveLength(0);
    }
    expect(fulfillmentAction(fact({ paymentStatus: 'unpaid' }), new Set(), new Set())).toBe('fail');
  });

  it('allows any profile and tooth count during a 30-day window and denies a closed one', () => {
    const openUntil = Date.parse('2026-11-20T00:00:00Z');
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(accessDecision({ accessDeadline: openUntil, now })).toEqual({ allowed: true, revise: false });
    expect(accessDecision({ accessDeadline: openUntil, now: openUntil + 1 })).toEqual({
      allowed: false,
      revise: false,
      reason: 'expired',
    });
    expect(base.profile).toBe('8M');
  });

  it('upgrades a 7-day purchase to 30 days from the original payment', () => {
    const paid = Date.parse('2026-10-20T00:00:00Z');
    const storedSevenDays = paid + 7 * 24 * 60 * 60 * 1000;
    const until = effectiveAccessDeadline(paid, storedSevenDays);
    expect(until - paid).toBe(ACCESS_MS);
    expect(accessDecision({ accessDeadline: until, now: Date.parse('2026-10-21T00:00:00Z') }).allowed).toBe(
      true,
    );
    expect(accessDecision({ accessDeadline: until, now: until + 1 }).allowed).toBe(false);
    expect(effectiveAccessDeadline(paid, paid + ACCESS_MS + 1000)).toBe(paid + ACCESS_MS + 1000);
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
      amount_total: 1000,
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
    expect(claimFromStripeSession({ ...paid, amount_total: 500 })).toBe('none');
    expect(claimFromStripeSession(null)).toBe('none');
    expect(paymentReturnMessage(true)).toContain('30 days');
    expect(paymentReturnMessage(false)).toContain('stay locked');
  });

  it('rejects a stored file the grant does not cover', () => {
    const designId = '2da326e0-990a-438d-80ee-3b765c66b7ae';
    expect(designFilePath(designId, 'step')).toBe(`designs/${designId}.step`);
    expect(designFilePath(designId, 'stl')).toBe(`designs/${designId}.stl`);
    expect(() => designFilePath('../secret', 'step')).toThrow('Invalid design.');
    expect(() => designFilePath(designId, 'price')).toThrow('Invalid file.');
    expect(
      authorizeStoredFile({ ownedDesignId: designId, requestedDesignId: designId, accessOpen: true }),
    ).toBe('allow');
    expect(
      authorizeStoredFile({ ownedDesignId: designId, requestedDesignId: 'other', accessOpen: true }),
    ).toBe('deny');
    expect(
      authorizeStoredFile({ ownedDesignId: designId, requestedDesignId: designId, accessOpen: false }),
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
      expect(await claimSession('cs_paid')).toBe('unlocked');
      expect(readGrants()['GT5:20']).toEqual({ token: 'grant-token', designId: 'design-a' });
      globalThis.fetch = async () => Response.json({ status: 'pending' });
      memory.clear();
      expect(await claimSession('cs_open')).toBe('pending');
      expect(readGrants()).toEqual({});
      globalThis.fetch = async () => Response.json({ status: 'paid', needsSignIn: true });
      expect(await claimSession('cs_paid_unsigned')).toBe('signin');
      expect(readGrants()).toEqual({});
      globalThis.fetch = async () => Response.json({ status: 'paid', needsSignIn: true, mismatch: true });
      expect(await claimSession('cs_paid_other')).toBe('mismatch');
      expect(readGrants()).toEqual({});
    } finally {
      globalThis.fetch = original;
      vi.unstubAllGlobals();
    }
  });

  it('does not upload a locked design and serves a stored file when the server has one', async () => {
    const original = globalThis.fetch;
    const local = new Blob(['local-step']);
    try {
      let uploads = 0;
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('/api/design-file') || url.includes('/api/designs')) uploads += 1;
        return Response.json({ allowed: false, reason: 'design' });
      };
      expect(await fileForDownload({ ...DEFAULTS }, 'step', local)).toBe(local);
      expect(uploads).toBe(0);
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.includes('/api/design-file')) return new Response('stored-step', { status: 200 });
        return Response.json({ allowed: true });
      };
      await expect((await fileForDownload({ ...DEFAULTS }, 'step', local)).text()).resolves.toBe('stored-step');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not attach an unpaid session and attaches a paid session only to the verified Google email', () => {
    const buyer = {
      orderStatus: 'paid' as const,
      purchaseEmail: 'buyer@example.com',
      googleEmail: 'buyer@example.com',
      emailVerified: true,
    };
    expect(attachDecision({ ...buyer, orderStatus: 'pending' })).toBe('deny');
    expect(attachDecision({ ...buyer, orderStatus: 'failed' })).toBe('deny');
    expect(attachDecision({ ...buyer, orderStatus: null })).toBe('deny');
    expect(attachDecision({ ...buyer, emailVerified: false })).toBe('deny');
    expect(attachDecision({ ...buyer, googleEmail: 'other@example.com' })).toBe('deny');
    expect(attachDecision({ ...buyer, googleEmail: '' })).toBe('deny');
    expect(attachDecision({ ...buyer, purchaseEmail: 'Buyer@Example.com' })).toBe('attach');
    expect(recoveryAvailable({})).toBe(true);
    expect(
      recoveryAvailable({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toBe(false);
    expect(googleAuthConfigured({ GOOGLE_CLIENT_ID: 'client' })).toBe(false);
    expect(validCheckoutSessionId('cs_test_abc12345')).toBe(true);
    expect(validCheckoutSessionId('cs_paid')).toBe(false);
    expect(googleRedirectUriForHost('pulleylab.vercel.app')).toBe(
      'https://pulleylab.zerocad.ai/api/google/callback',
    );
    expect(googleRedirectUriForHost('pulleylab.zerocad.ai')).toBe(
      'https://pulleylab.zerocad.ai/api/google/callback',
    );
  });

  it('allows any generation during the upgraded 30-day window and denies it after', () => {
    const paid = Date.parse('2026-10-14T00:00:00Z');
    const until = effectiveAccessDeadline(paid, paid + 7 * 24 * 60 * 60 * 1000);
    expect(until - paid).toBe(30 * 24 * 60 * 60 * 1000);
    expect(accessDecision({ accessDeadline: until, now: Date.parse('2026-10-21T00:00:00Z') }).allowed).toBe(
      true,
    );
    expect(accessDecision({ accessDeadline: until, now: until + 1 })).toMatchObject({
      allowed: false,
      reason: 'expired',
    });
  });

  it('accepts only a signed Google ID token for this client and nonce', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { kid?: string };
    jwk.kid = 'test-key';
    const now = 1_700_000_000;
    const claims = {
      iss: 'https://accounts.google.com',
      aud: 'client-id',
      exp: now + 60,
      email: 'Buyer@Example.com',
      email_verified: true,
      sub: 'google-subject',
      nonce: 'nonce-1',
    };
    const sign = (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test-key' }) => {
      const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = createSign('RSA-SHA256')
        .update(`${encodedHeader}.${encodedPayload}`)
        .sign(privateKey)
        .toString('base64url');
      return `${encodedHeader}.${encodedPayload}.${signature}`;
    };
    expect(googleIdentityFromClaims(claims, 'client-id', now, 'nonce-1')).toEqual({
      sub: 'google-subject',
      email: 'buyer@example.com',
    });
    expect(googleIdentityFromClaims({ ...claims, email_verified: false }, 'client-id', now, 'nonce-1')).toBeNull();
    expect(googleIdentityFromClaims(claims, 'client-id', now, 'other-nonce')).toBeNull();
    expect(verifyGoogleIdToken(sign(claims), 'client-id', [jwk], now, 'nonce-1')).toEqual({
      sub: 'google-subject',
      email: 'buyer@example.com',
    });
    const forged = sign(claims).replace(/.$/, (char) => (char === 'a' ? 'b' : 'a'));
    expect(verifyGoogleIdToken(forged, 'client-id', [jwk], now, 'nonce-1')).toBeNull();
    expect(verifyGoogleIdToken(sign(claims, { alg: 'none', kid: 'test-key' }), 'client-id', [jwk], now, 'nonce-1')).toBeNull();
    expect(verifyGoogleIdToken(sign({ ...claims, aud: 'other-client' }), 'client-id', [jwk], now, 'nonce-1')).toBeNull();
  });
});
