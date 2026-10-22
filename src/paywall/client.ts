import { track } from '@vercel/analytics';
import { upload } from '@vercel/blob/client';
import type { Parameters } from '../cad/parameters';
import { designKey, validCheckoutSessionId } from './access';

// The browser still builds STEP and STL. The server decides whether this
// account's 30-day window is open, then stores the files.

const STORAGE = 'pulleylab:grants:v1';
export type StoredGrant = { token: string; designId: string };
export type DownloadVerdict = 'allowed' | 'locked' | 'offline' | 'expired';
type GrantPayload = { profile: string; teeth: number; token: string; designId: string };

// Back-forward cache restores this document with checkout still "opening".
// Clear that in-flight flag when the page is frozen and when that frozen page
// returns. A stored unlock lives in sessionStorage and is not an input here.
export function nextCheckoutBusy(
  busy: boolean,
  event: { type: string; persisted: boolean },
): boolean {
  if (event.type === 'pagehide') return false;
  if (event.type === 'pageshow' && event.persisted) return false;
  return busy;
}

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

export function clearGrants() {
  try {
    sessionStorage.removeItem(STORAGE);
  } catch {
    // A blocked storage API still leaves the server session as the authority.
  }
}

function remember(grants: GrantPayload[] | undefined) {
  for (const grant of grants ?? [])
    saveGrant(grant.profile, grant.teeth, { token: grant.token, designId: grant.designId });
}

export async function verifyDownload(parameters: Parameters): Promise<DownloadVerdict> {
  const grant = readGrants()[designKey(parameters)];
  try {
    const response = await fetch('/api/entitlement', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant: grant?.token, designId: grant?.designId, parameters }),
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

export type ClaimResult = 'unlocked' | 'signin' | 'mismatch' | 'pending' | 'locked';

/** Only a successful Checkout return carries a session id. Canceled stays locked. */
export function returnSessionId(search: string) {
  const params = new URLSearchParams(search);
  if (params.get('checkout') !== 'success') return null;
  return params.get('session_id') || null;
}

export function paymentReturnMessage(claimed: boolean) {
  return claimed
    ? 'Payment received. You have 30 days of unlimited generations and downloads.'
    : 'Payment is not confirmed yet. Downloads stay locked.';
}

export function signInHref(sessionId?: string | null) {
  if (sessionId && validCheckoutSessionId(sessionId))
    return `/api/google/start?session_id=${encodeURIComponent(sessionId)}`;
  return '/api/google/start';
}

export type SavedDesign = {
  designId: string;
  profile: string;
  teeth: number;
  parameters: Record<string, unknown>;
  createdAt: string;
  hasStep: boolean;
  hasStl: boolean;
};

export type AccountSnapshot = {
  google: boolean;
  signedIn: boolean;
  accessActive: boolean;
  accessUntil: string | null;
  designs: SavedDesign[];
};

const EMPTY_ACCOUNT: AccountSnapshot = {
  google: false,
  signedIn: false,
  accessActive: false,
  accessUntil: null,
  designs: [],
};

export async function loadAccount(): Promise<AccountSnapshot> {
  try {
    const response = await fetch('/api/account', { credentials: 'same-origin' });
    if (!response.ok) return EMPTY_ACCOUNT;
    const body = (await response.json()) as Partial<AccountSnapshot>;
    const designs = Array.isArray(body.designs) ? body.designs : [];
    return {
      google: Boolean(body.google),
      signedIn: Boolean(body.signedIn),
      accessActive: Boolean(body.accessActive),
      accessUntil: body.accessUntil ?? null,
      designs,
    };
  } catch {
    return EMPTY_ACCOUNT;
  }
}

export async function signOut() {
  await fetch('/api/account', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'logout' }),
  });
  clearGrants();
}

export async function claimSession(sessionId: string): Promise<ClaimResult> {
  try {
    const response = await fetch('/api/entitlement', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) return response.status >= 500 ? 'pending' : 'locked';
    const body = (await response.json()) as {
      status?: string;
      needsSignIn?: boolean;
      mismatch?: boolean;
      grants?: GrantPayload[];
    };
    if (body.status === 'paid' && body.needsSignIn) return body.mismatch ? 'mismatch' : 'signin';
    if (body.status === 'paid' && body.grants?.length) {
      remember(body.grants);
      try {
        track('purchase_completed');
      } catch {
        // Analytics must not hide a completed purchase.
      }
      return 'unlocked';
    }
    if (body.status === 'pending') return 'pending';
    return 'locked';
  } catch {
    return 'pending';
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

const FILE_URL = '/api/design-file';

async function openSave(parameters: Parameters) {
  const response = await fetch('/api/designs', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parameters }),
  });
  if (response.status === 401) throw Error('signin');
  if (response.status === 403) throw Error('expired');
  if (!response.ok) throw Error('save');
  return (await response.json()) as {
    designId: string;
    uploadToken: string | null;
    complete: boolean;
  };
}

async function putDesignFile(
  save: { designId: string; uploadToken: string },
  parameters: Parameters,
  kind: 'step' | 'stl',
  local: Blob,
) {
  const claim = { grant: save.uploadToken, designId: save.designId, kind, parameters };
  await upload(`designs/${save.designId}.${kind}`, local, {
    access: 'private',
    handleUploadUrl: FILE_URL,
    contentType: kind === 'step' ? 'application/step' : 'model/stl',
    clientPayload: JSON.stringify(claim),
  });
  const commit = await fetch(FILE_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'commit', ...claim }),
  });
  if (commit.status === 403) {
    const body = (await commit.json().catch(() => ({}))) as { reason?: string };
    throw Error(body.reason === 'expired' ? 'expired' : 'locked');
  }
  if (!commit.ok) throw Error('save');
}

/** Stores parameters plus STEP and STL while the account's access window is open. */
export async function saveGeneratedDesign(
  parameters: Parameters,
  files: { step: Blob; stl: Blob },
) {
  const save = await openSave(parameters);
  if (save.complete || !save.uploadToken) return { designId: save.designId, uploaded: false };
  const token = save.uploadToken;
  await Promise.all(
    (['step', 'stl'] as const).map((kind) =>
      putDesignFile({ designId: save.designId, uploadToken: token }, parameters, kind, files[kind]),
    ),
  );
  return { designId: save.designId, uploaded: true };
}

/** Prefer the private stored file. If it is missing, upload the browser-generated file once. */
export async function fileForDownload(parameters: Parameters, kind: 'step' | 'stl', local: Blob) {
  const verdict = await verifyDownload(parameters);
  if (verdict === 'expired') throw Error('expired');
  if (verdict === 'offline') throw Error('offline');
  if (verdict !== 'allowed') return local;
  try {
    const response = await fetch(FILE_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'download', kind, parameters }),
    });
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as { reason?: string };
      throw Error(body.reason === 'expired' ? 'expired' : 'locked');
    }
    if (response.ok) return response.blob();
    if (response.status !== 404) return local;
    const save = await openSave(parameters);
    if (!save.uploadToken) return local;
    await putDesignFile(
      { designId: save.designId, uploadToken: save.uploadToken },
      parameters,
      kind,
      local,
    );
  } catch (error) {
    if (error instanceof Error && (error.message === 'locked' || error.message === 'expired' || error.message === 'signin'))
      throw error;
  }
  return local;
}

/** A stored STEP or STL for a signed-in design. Null means the file was never stored. */
export async function downloadStoredFile(designId: string, kind: 'step' | 'stl') {
  const response = await fetch(FILE_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'download', designId, kind }),
  });
  if (response.status === 404) return null;
  if (response.status === 403) {
    const body = (await response.json().catch(() => ({}))) as { reason?: string };
    throw Error(body.reason === 'expired' ? 'expired' : 'locked');
  }
  if (!response.ok) throw Error('offline');
  return response.blob();
}
