import { createPublicKey, createVerify } from 'node:crypto';
import { googleIdentityFromClaims, type GoogleIdentity } from '../src/paywall/access.js';

type Jwk = JsonWebKey & { kid?: string };

function decodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function signatureMatches(token: string, jwk: Jwk) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature || !jwk.n || !jwk.e) return false;
  const key = createPublicKey({
    key: { kty: 'RSA', n: jwk.n, e: jwk.e },
    format: 'jwk',
  });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  return verifier.verify(key, Buffer.from(signature, 'base64url'));
}

/** Verifies the Google signature, then accepts only a verified email for this client. */
export function verifyGoogleIdToken(
  token: string,
  clientId: string,
  keys: Jwk[],
  nowSeconds: number,
  nonce: string,
): GoogleIdentity | null {
  if (!token || token.length > 8000) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: { alg?: unknown; kid?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(parts[0]) as { alg?: unknown; kid?: unknown };
    payload = decodeJson(parts[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk || !signatureMatches(token, jwk)) return null;
  return googleIdentityFromClaims(payload, clientId, nowSeconds, nonce);
}

export async function fetchGoogleCerts(): Promise<Jwk[]> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) throw Error('Google certificates are unavailable.');
  const body = (await response.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}
