import { validate, type Parameters } from '../src/cad/parameters.js';
import { accessDecision, googleAuthConfigured } from '../src/paywall/access.js';
import { sql } from './db.js';
import { hashGrant } from './grant.js';
import { mintGrant } from './grants.js';
import { attachSettledPurchase, linkAccountPurchases, settleCheckoutSession } from './purchase.js';
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

// Soft gate: STEP and STL are still generated in the browser. This route only
// decides whether the browser may save that local file.

async function revisionsFor(id: string) {
  const db = sql();
  const rows = (await db('SELECT parameters FROM revisions WHERE entitlement_id = $1', [id])) as {
    parameters: Parameters;
  }[];
  return rows.map((row) => row.parameters as unknown as Record<string, unknown>);
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
    const settled = await settleCheckoutSession(body.sessionId);
    if (settled.status !== 'paid') return Response.json({ status: settled.status });
    if (googleAuthConfigured(process.env)) {
      const identity = await currentAccount(request);
      if (!identity) return Response.json({ status: 'paid', needsSignIn: true });
      await linkAccountPurchases(identity);
      const decision = await attachSettledPurchase(identity, settled);
      if (decision !== 'attach')
        return Response.json({ status: 'paid', needsSignIn: true, mismatch: true });
    }
    return Response.json({ status: 'paid', grants: [await mintGrant(settled.row)] });
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
