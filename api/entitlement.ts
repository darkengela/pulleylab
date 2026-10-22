import { validate, type Parameters } from '../src/cad/parameters.js';
import { accessDecision, googleAuthConfigured } from '../src/paywall/access.js';
import { sql } from './db.js';
import { hashGrant } from './grant.js';
import { mintGrant } from './grants.js';
import { accountAccess, attachSettledPurchase, linkAccountPurchases, settleCheckoutSession } from './purchase.js';
import { currentAccount } from './session.js';

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

// The browser still builds STEP and STL. This route decides whether that
// account's 30-day window is open. A success URL is not access.

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
    const settled = await settleCheckoutSession(body.sessionId);
    if (settled.status !== 'paid') return Response.json({ status: settled.status });
    if (googleAuthConfigured(process.env)) {
      const identity = await currentAccount(request);
      if (!identity) return Response.json({ status: 'paid', needsSignIn: true });
      await linkAccountPurchases(identity);
      const decision = await attachSettledPurchase(identity, settled);
      if (decision !== 'attach')
        return Response.json({ status: 'paid', needsSignIn: true, mismatch: true });
      const access = await accountAccess(identity.sub);
      return Response.json({
        status: 'paid',
        accessActive: Boolean(access),
        accessUntil: access?.accessUntil ?? null,
        grants: [await mintGrant(settled.row)],
      });
    }
    return Response.json({ status: 'paid', grants: [await mintGrant(settled.row)] });
  }
  if (googleAuthConfigured(process.env)) {
    try {
      validate(body.parameters);
    } catch (error) {
      return Response.json({ allowed: false, error: (error as Error).message }, { status: 400 });
    }
    const identity = await currentAccount(request);
    if (!identity) return Response.json({ allowed: false, reason: 'design' });
    await linkAccountPurchases(identity);
    const access = await accountAccess(identity.sub);
    if (!access) return Response.json({ allowed: false, reason: 'expired' });
    return Response.json({ allowed: true, accessUntil: access.accessUntil });
  }
  if (!body.grant || !body.designId)
    return Response.json({ allowed: false, reason: 'design' });
  try {
    validate(body.parameters);
  } catch (error) {
    return Response.json({ allowed: false, error: (error as Error).message }, { status: 400 });
  }
  const rows = (await db('SELECT * FROM entitlements WHERE grant_hash = $1', [
    hashGrant(body.grant),
  ])) as EntitlementRow[];
  const row = rows[0];
  if (!row || row.design_id !== body.designId) return Response.json({ allowed: false, reason: 'design' });
  if (!row.grant_expires_at || new Date(row.grant_expires_at).getTime() < Date.now())
    return Response.json({ allowed: false, reason: 'expired' });
  const decision = accessDecision({
    accessDeadline: new Date(row.adjustment_deadline).getTime(),
    now: Date.now(),
  });
  return Response.json({ allowed: decision.allowed, reason: decision.reason });
}
