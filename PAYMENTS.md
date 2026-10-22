# Payments

PulleyLab charges **$5** once for one design: one belt profile and tooth count, including STEP and STL. Preview, ratio planning, and fit changes listed below stay in the browser. Generation is not moved to a server.

This is a soft gate. The browser still builds the solid. The server only records the paid design and hands back a short-lived grant. The grant is checked before a download is saved. A success URL, a typed email, or local storage alone does not unlock a file.

## Environment variables

Set these on the Vercel project. Do not put the values in source files.

- `DATABASE_URL` — Neon connection string already attached to the project
- `STRIPE_SECRET_KEY` — Stripe **test** secret key (`sk_test_…`)
- `STRIPE_WEBHOOK_SECRET` — signing secret for the webhook endpoint (`whsec_…`)
- `STRIPE_PRICE_ID` — one-time **test** Price for $5 USD (`price_…`)

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are read only by the server routes under `api/`.

## Go-live checklist

1. In Stripe **test mode**, create a $5 USD one-time product and copy its Price id into `STRIPE_PRICE_ID`.
2. Put `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` on the Vercel project.
3. Apply `schema.sql` once to that Neon database. The file only creates missing tables.
4. For local webhook tests, forward with the Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe-webhook` (or the Vercel dev URL). Use the CLI signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Point the Stripe webhook at `https://<your-domain>/api/stripe-webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, and `payment_intent.payment_failed`.
6. Pay with Stripe’s test card. Confirm the design saves before redirect, a canceled payment does not unlock downloads, and a paid return downloads only after the webhook has written the entitlement.
7. Switch to live keys only when you explicitly decide to. Do not flip the test Price, secret, or webhook secret to live before that.

## What a purchase covers

- Repeat downloads of that profile and tooth count are free.
- For 7 days the buyer can change bore, D-shaft flat, and clearance on that design without paying again. Those revisions are stored.
- A different profile or tooth count is a new $5 design.
- A failed or canceled Checkout does not grant access. A failed export does not spend the purchase.

## Saving a design

Google sign-in is how a customer keeps a purchase and opens it on another browser. The server checks the Google ID token, then attaches paid designs whose stored Stripe email is that Google email. A typed email, a success URL, or a grant saved in the browser does not unlock a design by itself.

Set these on the PulleyLab Vercel project (`prj_gSPGdL9q9Bo3Va4qL99ATv5vzupL`) for Production and Preview. Do not put the values in source files.

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

In Google Cloud, for this site only:

1. OAuth consent screen: External, app name PulleyLab, authorized domain `zerocad.ai`. Publish the app. While it stays in Testing, only listed test users can sign in.
2. Create an OAuth client ID, application type Web application.
3. Authorized JavaScript origin: `https://pulleylab.zerocad.ai`
4. Authorized redirect URI: `https://pulleylab.zerocad.ai/api/google/callback`

Until both variables are set, the page keeps a small “Recover with checkout email” path. That path checks a Checkout session id or recovery code on the server. It is not shown once Google sign-in is configured.

`schema.sql` adds `accounts`, `auth_sessions`, and `entitlements.google_sub`. The API applies those statements on first use. Each statement is `IF NOT EXISTS`, so running it again does not rewrite existing rows.

## Recovery

The buyer enters the email Stripe collected plus either the Checkout session id (`cs_…`) or a one-time code. The server checks the session against Stripe, or checks a hashed code. The code is not returned to the browser. This project does not include a mail provider, so a code is stored but not emailed until one is added; the session-id check works with the four variables above. Use this only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are unset.

## Local note

`npm run dev` serves the Vite app only. The `api/` routes run on Vercel. Without the four variables, download shows the $5 confirmation and Checkout stays on the page. The error toast names whichever of `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` are unset. Checkout cannot start until the first three are set. Do not paste secrets into the repo. `.gitignore` already ignores `.env` files.
