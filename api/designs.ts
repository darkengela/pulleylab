import { validate } from '../src/cad/parameters.js';
import { checkoutErrorMessage } from '../src/paywall/access.js';
import { createSavedDesign } from './purchase.js';
import { currentAccount } from './session.js';

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL)
    return Response.json({ error: 'Payments are not configured.' }, { status: 503 });
  let body: { parameters?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  let parameters;
  try {
    parameters = validate(body.parameters);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    const identity = await currentAccount(request);
    if (!identity) return Response.json({ error: 'Sign in to save this design.' }, { status: 401 });
    const saved = await createSavedDesign(identity, parameters);
    if (!saved)
      return Response.json(
        {
          error: 'Your 30-day access has ended. A new $10 payment is required to generate again.',
          reason: 'expired',
        },
        { status: 403 },
      );
    return Response.json(saved);
  } catch (error) {
    console.error('save design failed', checkoutErrorMessage(error));
    return Response.json({ error: 'This design could not be saved.' }, { status: 503 });
  }
}
