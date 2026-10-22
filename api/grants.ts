import { GRANT_MS } from '../src/paywall/access.js';
import { sql } from './db.js';
import { newGrant } from './grant.js';

export async function mintGrant(row: { id: string; profile: string; teeth: number | string; design_id: string }) {
  const db = sql();
  const grant = newGrant();
  const expires = new Date(Date.now() + GRANT_MS).toISOString();
  await db('UPDATE entitlements SET grant_hash = $1, grant_expires_at = $2 WHERE id = $3', [
    grant.hash,
    expires,
    row.id,
  ]);
  return {
    profile: row.profile,
    teeth: Number(row.teeth),
    token: grant.token,
    designId: row.design_id,
  };
}
