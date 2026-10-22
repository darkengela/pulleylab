import {
  googleAuthConfigured,
  googleRedirectUriForHost,
  validCheckoutSessionId,
} from '../../src/paywall/access.js';
import { fetchGoogleCerts, verifyGoogleIdToken } from '../google-token.js';
import { attachSettledPurchase, linkAccountPurchases, settleCheckoutSession } from '../purchase.js';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  decodeOAuthPending,
  openSession,
  readCookie,
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

export async function GET(request: Request) {
  const secure = requestIsSecure(request);
  const done = (account: string) =>
    redirect(`/?account=${account}`, [clearCookie(OAUTH_COOKIE, secure)]);
  if (!googleAuthConfigured(process.env) || !process.env.DATABASE_URL) return done('unconfigured');
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return done('denied');
  const code = url.searchParams.get('code');
  const pending = decodeOAuthPending(readCookie(request, OAUTH_COOKIE), url.searchParams.get('state'));
  if (!code || !pending) return done('denied');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const redirectUri = googleRedirectUriForHost(host);
  let idToken = '';
  try {
    const exchanged = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: pending.verifier,
      }),
    });
    if (!exchanged.ok) return done('denied');
    const body = (await exchanged.json()) as { id_token?: string };
    idToken = body.id_token ?? '';
    const identity = verifyGoogleIdToken(
      idToken,
      clientId,
      await fetchGoogleCerts(),
      Math.floor(Date.now() / 1000),
      pending.nonce,
    );
    if (!identity) return done('denied');
    await linkAccountPurchases(identity);
    let account = 'saved';
    const sessionId = validCheckoutSessionId(pending.sessionId) ? pending.sessionId : null;
    if (sessionId) {
      const settled = await settleCheckoutSession(sessionId);
      if (settled.status === 'paid') {
        const decision = await attachSettledPurchase(identity, settled);
        if (decision !== 'attach') account = 'mismatch';
      } else if (settled.status === 'pending') account = 'unpaid';
      else account = 'unpaid';
    }
    const token = await openSession(identity);
    return redirect(`/?account=${account}`, [
      clearCookie(OAUTH_COOKIE, secure),
      setCookie(SESSION_COOKIE, token, 30 * 24 * 60 * 60, secure),
    ]);
  } catch (error) {
    console.error('google callback failed', error instanceof Error ? error.name : 'error');
    return done('denied');
  }
}
