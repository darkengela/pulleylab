import { track } from '@vercel/analytics';
import type { Parameters } from '../cad/parameters';
import { designKey } from './access';

// Soft gate: STEP and STL are still generated in the browser. A grant only
// decides whether this page may save that local file. It is not a DRM boundary.

const STORAGE = 'pulleylab:grants:v1';
export type StoredGrant = { token: string; designId: string };
export type DownloadVerdict = 'allowed' | 'locked' | 'offline' | 'expired';
type GrantPayload = { profile: string; teeth: number; token: string; designId: string };

export function readGrants(): Record<string, StoredGrant> {
  try {
    const raw = sessionStorage.getItem(STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredGrant>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveGrant(profile: string, teeth: number, grant: StoredGrant) {
  const all = readGrants();
  all[designKey({ profile, teeth })] = grant;
  sessionStorage.setItem(STORAGE, JSON.stringify(all));
}

function remember(grants: GrantPayload[] | undefined) {
  for (const grant of grants ?? [])
    saveGrant(grant.profile, grant.teeth, { token: grant.token, designId: grant.designId });
}

export async function verifyDownload(parameters: Parameters): Promise<DownloadVerdict> {
  const grant = readGrants()[designKey(parameters)];
  if (!grant) return 'locked';
  try {
    const response = await fetch('/api/entitlement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant.token, designId: grant.designId, parameters }),
    });
    if (!response.ok) return response.status >= 500 ? 'offline' : 'locked';
    const body = (await response.json()) as { allowed?: boolean; reason?: string };
    if (body.allowed) return 'allowed';
    if (body.reason === 'expired') return 'expired';
    return 'locked';
  } catch {
    return 'offline';
  }
}

export async function startCheckout(parameters: Parameters) {
  const response = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parameters }),
  });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw Error(body.error || 'Checkout could not be started.');
  return body.url;
}

export async function claimSession(sessionId: string) {
  try {
    const response = await fetch('/api/entitlement', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: string; grants?: GrantPayload[] };
    if (body.status !== 'paid' || !body.grants?.length) return false;
    remember(body.grants);
    track('purchase_completed');
    return true;
  } catch {
    return false;
  }
}

export async function recoverPurchase(email: string, proof: { sessionId?: string; code?: string }) {
  const response = await fetch('/api/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, ...proof }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    grants?: GrantPayload[];
    sent?: boolean;
    error?: string;
  };
  if (!response.ok) throw Error(body.error || 'That purchase could not be verified.');
  if (body.grants?.length) {
    remember(body.grants);
    return body;
  }
  return body;
}
