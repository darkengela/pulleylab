import Stripe from 'stripe';
import type { Parameters } from '../src/cad/parameters.js';
import {
  attachDecision,
  claimFromStripeSession,
  designFilePath,
  sameParameters,
  sessionMatchesOrder,
} from '../src/paywall/access.js';
import { sql } from './db.js';
import { grantPaidOrder } from './fulfill.js';
import { grantHashEquals, newGrant } from './grant.js';
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
    `UPDATE entitlements AS e
     SET email = lower(o.email)
     FROM orders AS o
     WHERE e.order_id = o.id
       AND o.status = 'paid'
       AND (e.email = '' OR e.email IS NULL)
       AND coalesce(o.email, '') <> ''`,
  );
  await db(
    `UPDATE entitlements AS e
     SET google_sub = $1
     FROM orders AS o
     WHERE e.order_id = o.id
       AND o.status = 'paid'
       AND (e.google_sub IS NULL OR e.google_sub = $1)
       AND (
         lower(e.email) = $2
         OR lower(coalesce(o.email, '')) = $2
       )
       AND (e.email <> '' OR coalesce(o.email, '') <> '')`,
    [account.sub, account.email],
  );
  await upgradeAccessWindows();
  await db(
    `UPDATE designs AS d
     SET google_sub = e.google_sub,
         entitlement_id = coalesce(d.entitlement_id, e.id),
         email = CASE WHEN d.email IS NULL OR d.email = '' THEN e.email ELSE d.email END
     FROM entitlements AS e
     WHERE d.id = e.design_id
       AND e.google_sub = $1
       AND (d.google_sub IS NULL OR d.google_sub = $1)`,
    [account.sub],
  );
}

/** Extends a stored 7-day fit window to 30 days from the original payment. */
export async function upgradeAccessWindows() {
  const db = sql();
  await db(
    `UPDATE entitlements
     SET adjustment_deadline = created_at + interval '30 days'
     WHERE adjustment_deadline < created_at + interval '30 days'`,
  );
}

export type AccountAccess = { entitlementId: string; accessUntil: string };

export async function accountAccess(sub: string): Promise<AccountAccess | null> {
  await upgradeAccessWindows();
  const db = sql();
  const rows = (await db(
    `SELECT e.id, e.adjustment_deadline
     FROM entitlements e
     JOIN orders o ON o.id = e.order_id
     WHERE e.google_sub = $1 AND o.status = 'paid' AND e.adjustment_deadline > now()
     ORDER BY e.adjustment_deadline DESC
     LIMIT 1`,
    [sub],
  )) as { id: string; adjustment_deadline: string }[];
  const row = rows[0];
  if (!row) return null;
  return {
    entitlementId: row.id,
    accessUntil: new Date(row.adjustment_deadline).toISOString(),
  };
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

export type SavedDesignRow = {
  design_id: string;
  profile: string;
  teeth: number;
  parameters: unknown;
  created_at: string;
  has_step: boolean;
  has_stl: boolean;
};

export async function savedDesigns(sub: string) {
  const db = sql();
  return (await db(
    `SELECT d.id AS design_id, d.profile, d.teeth, d.parameters, d.created_at,
            (d.step_blob_path IS NOT NULL) AS has_step,
            (d.stl_blob_path IS NOT NULL) AS has_stl
     FROM designs d
     WHERE d.google_sub = $1
        OR d.id IN (SELECT design_id FROM entitlements WHERE google_sub = $1)
     ORDER BY d.created_at DESC
     LIMIT 100`,
    [sub],
  )) as SavedDesignRow[];
}

export type StoredDesignRow = {
  id: string;
  google_sub: string | null;
  parameters: unknown;
  upload_grant_hash: string | null;
  step_blob_path: string | null;
  stl_blob_path: string | null;
  step_file_parameters: unknown;
  stl_file_parameters: unknown;
};

function fileComplete(row: StoredDesignRow, kind: 'step' | 'stl', parameters: Parameters) {
  const path = kind === 'step' ? row.step_blob_path : row.stl_blob_path;
  const stored = kind === 'step' ? row.step_file_parameters : row.stl_file_parameters;
  const record =
    stored && typeof stored === 'object'
      ? (stored as Record<string, unknown>)
      : null;
  return (
    path === designFilePath(row.id, kind) &&
    !!record &&
    sameParameters(record, parameters as unknown as Record<string, unknown>)
  );
}

/** Records a generation on the Google account while the 30-day window is open. */
export async function createSavedDesign(account: Account, parameters: Parameters) {
  const access = await accountAccess(account.sub);
  if (!access) return null;
  const db = sql();
  const encoded = JSON.stringify(parameters);
  const existing = (await db(
    `SELECT id, google_sub, parameters, upload_grant_hash, step_blob_path, stl_blob_path,
            step_file_parameters, stl_file_parameters
     FROM designs
     WHERE google_sub = $1 AND parameters = $2::jsonb
     ORDER BY created_at DESC
     LIMIT 1`,
    [account.sub, encoded],
  )) as StoredDesignRow[];
  let row = existing[0];
  if (!row) {
    const id = crypto.randomUUID();
    await db(
      `INSERT INTO designs (id, profile, teeth, parameters, email, google_sub, entitlement_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [id, parameters.profile, parameters.teeth, encoded, account.email, account.sub, access.entitlementId],
    );
    row = {
      id,
      google_sub: account.sub,
      parameters,
      upload_grant_hash: null,
      step_blob_path: null,
      stl_blob_path: null,
      step_file_parameters: null,
      stl_file_parameters: null,
    };
  } else {
    await db(
      `UPDATE designs SET entitlement_id = coalesce(entitlement_id, $1), google_sub = $2 WHERE id = $3`,
      [access.entitlementId, account.sub, row.id],
    );
  }
  const complete = fileComplete(row, 'step', parameters) && fileComplete(row, 'stl', parameters);
  let uploadToken: string | null = null;
  if (!complete) {
    const grant = newGrant();
    uploadToken = grant.token;
    await db('UPDATE designs SET upload_grant_hash = $1 WHERE id = $2', [grant.hash, row.id]);
  }
  return { designId: row.id, uploadToken, complete };
}

export async function designRecord(designId: string) {
  const db = sql();
  const rows = (await db(
    `SELECT id, google_sub, profile, teeth, parameters, upload_grant_hash,
            step_blob_path, stl_blob_path, step_file_parameters, stl_file_parameters
     FROM designs WHERE id = $1`,
    [designId],
  )) as StoredDesignRow[];
  return rows[0] ?? null;
}

export async function ownedDesign(sub: string, designId: string) {
  const db = sql();
  const rows = (await db(
    `SELECT id, google_sub, profile, teeth, parameters, upload_grant_hash,
            step_blob_path, stl_blob_path, step_file_parameters, stl_file_parameters
     FROM designs
     WHERE id = $1 AND (google_sub = $2 OR id IN (SELECT design_id FROM entitlements WHERE google_sub = $2))`,
    [designId, sub],
  )) as StoredDesignRow[];
  return rows[0] ?? null;
}

export function uploadTokenMatches(row: { upload_grant_hash: string | null }, token: string | undefined) {
  if (!token || !row.upload_grant_hash) return false;
  try {
    return grantHashEquals(row.upload_grant_hash, token);
  } catch {
    return false;
  }
}
