import { checkoutErrorMessage, googleAuthConfigured } from '../src/paywall/access.js';
import { accountAccess, linkAccountPurchases, savedDesigns } from './purchase.js';
import {
  SESSION_COOKIE,
  clearCookie,
  currentAccount,
  endSession,
  requestIsSecure,
} from './session.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export async function GET(request: Request) {
  const google = googleAuthConfigured(process.env);
  const empty = { google, signedIn: false, accessActive: false, accessUntil: null, designs: [] };
  if (!process.env.DATABASE_URL) return Response.json(empty);
  try {
    const identity = await currentAccount(request);
    if (!identity) return Response.json(empty);
    await linkAccountPurchases(identity);
    const access = await accountAccess(identity.sub);
    const rows = await savedDesigns(identity.sub);
    const designs = rows.map((row) => ({
      designId: row.design_id,
      profile: row.profile,
      teeth: Number(row.teeth),
      parameters: asRecord(row.parameters) ?? {},
      createdAt: iso(row.created_at),
      hasStep: Boolean(row.has_step),
      hasStl: Boolean(row.has_stl),
    }));
    return Response.json(
      {
        google,
        signedIn: true,
        accessActive: Boolean(access),
        accessUntil: access?.accessUntil ?? null,
        designs,
      },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('account failed', checkoutErrorMessage(error));
    return Response.json({ error: 'Saved designs are unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (body.action !== 'logout') return Response.json({ error: 'Invalid request.' }, { status: 400 });
  if (process.env.DATABASE_URL) {
    try {
      await endSession(request);
    } catch (error) {
      console.error('sign out failed', checkoutErrorMessage(error));
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      'set-cookie': clearCookie(SESSION_COOKIE, requestIsSecure(request)),
    },
  });
}
