import { ACCESS_MS } from '../src/paywall/access.js';

type Query = (text: string, params?: unknown[]) => Promise<unknown[]>;

/** Idempotent. A second delivery for the same order does not create a second entitlement. */
export async function grantPaidOrder(
  db: Query,
  input: { orderId: string; designId: string; email?: string | null },
) {
  const email = (input.email || '').trim().toLowerCase();
  const designs = (await db('SELECT profile, teeth, parameters FROM designs WHERE id = $1', [
    input.designId,
  ])) as { profile: string; teeth: number; parameters: unknown }[];
  const design = designs[0];
  await db(
    `INSERT INTO entitlements
      (id, order_id, design_id, email, profile, teeth, parameters, adjustment_deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      crypto.randomUUID(),
      input.orderId,
      input.designId,
      email,
      design?.profile ?? '',
      design?.teeth ?? 0,
      JSON.stringify(design?.parameters ?? {}),
      new Date(Date.now() + ACCESS_MS).toISOString(),
    ],
  );
  await db(
    `UPDATE orders SET status = $1, email = COALESCE(NULLIF($2, ''), email) WHERE id = $3`,
    ['paid', email, input.orderId],
  );
  if (email) {
    await db('UPDATE designs SET email = $1 WHERE id = $2 AND email IS NULL', [email, input.designId]);
    await db(`UPDATE entitlements SET email = $1 WHERE order_id = $2 AND email = ''`, [
      email,
      input.orderId,
    ]);
  }
}
