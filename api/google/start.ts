import { createHash } from 'node:crypto';
import {
  googleAuthConfigured,
  googleRedirectUriForHost,
  validCheckoutSessionId,
} from '../../src/paywall/access.js';
import {
  OAUTH_COOKIE,
  encodeOAuthPending,
  newOAuthPending,
  requestIsSecure,
  setCookie,
} from '../session.js';

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function GET(request: Request) {
  if (!googleAuthConfigured(process.env) || !process.env.DATABASE_URL)
    return redirect('/?account=unconfigured');
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) return redirect('/?account=unconfigured');
  const url = new URL(request.url);
  const sessionId = validCheckoutSessionId(url.searchParams.get('session_id'))
    ? url.searchParams.get('session_id')
    : null;
  const pending = newOAuthPending(sessionId);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const redirectUri = googleRedirectUriForHost(host);
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.searchParams.set('client_id', clientId);
  google.searchParams.set('redirect_uri', redirectUri);
  google.searchParams.set('response_type', 'code');
  google.searchParams.set('scope', 'openid email');
  google.searchParams.set('state', pending.state);
  google.searchParams.set('nonce', pending.nonce);
  google.searchParams.set('code_challenge', pkceChallenge(pending.verifier));
  google.searchParams.set('code_challenge_method', 'S256');
  google.searchParams.set('prompt', 'select_account');
  const secure = requestIsSecure(request);
  return redirect(google.toString(), [
    setCookie(OAUTH_COOKIE, encodeOAuthPending(pending), 10 * 60, secure),
  ]);
}
