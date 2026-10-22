# Payments

PulleyLab charges **$10** once for 30 days of unlimited generations and downloads. Any belt profile and tooth count is included, with STEP and STL. Preview stays in the browser. The server records each generated design and its files for the signed-in Google account.

The browser still builds the solid. The server decides whether the account's access window is open, then stores the parameters and the STEP/STL files. A success URL, a typed email, or local storage alone does not unlock a file.

## Environment variables

Set these on the Vercel project. Do not put the values in source files.

- `DATABASE_URL` — Neon connection string already attached to the project
- `STRIPE_SECRET_KEY` — Stripe secret key (`sk_…` or `rk_…`)
- `STRIPE_WEBHOOK_SECRET` — signing secret for the webhook endpoint (`whsec_…`)
- `STRIPE_PRICE_ID` — one-time Price for **$10** USD (`price_…`)

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are read only by the server routes under `api/`.

## Go-live checklist

1. In Stripe, create a $10 USD one-time Price and copy its Price id into `STRIPE_PRICE_ID` on Production and Preview. Leave any older $5 Price in place so an existing payment can still be retrieved.
2. Put `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_ID` on the Vercel project.
3. Apply `schema.sql` once to that Neon database. The file creates missing tables and extends an older 7-day fit window to 30 days from the original payment. It does not delete rows.
4. For local webhook tests, forward with the Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe-webhook` (or the Vercel dev URL). Use the CLI signing secret as `STRIPE_WEBHOOK_SECRET`.
5. Point the Stripe webhook at `https://<your-domain>/api/stripe-webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, and `payment_intent.payment_failed`.
6. Pay with a live or test card only when you mean to. Confirm a canceled payment does not unlock downloads, and a paid return unlocks only after the server has recorded the paid order. The webhook ignores an amount other than 1000 USD cents.
7. Switch keys only when you explicitly decide to. Do not commit secrets.

## What a purchase covers

- One $10 payment opens 30 days of unlimited profile, tooth count, generation, and STEP/STL download, measured from the payment time.
- While that window is open, every design a signed-in customer generates is saved to the Google account whose verified email matches the Stripe receipt. Parameters and STEP/STL go to the private Blob store.
- Signing in later lists those designs. New generation and download stay available until the window ends. After 30 days the list remains visible. Another $10 payment is required to generate or download again.
- An older $5 purchase is the same kind of access for 30 days from its original payment time. It does not require a second payment while that upgraded window is open.
- A failed or canceled Checkout does not grant access.

## Saving a design

Google sign-in is how a customer keeps designs and opens them on another browser. The server checks the Google ID token, then attaches paid orders whose stored Stripe email is that Google email. Generation inserts a design row and uploads STEP and STL. A typed email, a success URL, or a grant saved in the browser does not unlock a design by itself.

Set these on the PulleyLab Vercel project (`prj_gSPGdL9q9Bo3Va4qL99ATv5vzupL`) for Production and Preview. Do not put the values in source files.

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

In Google Cloud, for this site only:

1. OAuth consent screen: External, app name PulleyLab, authorized domain `zerocad.ai`. Publish the app. While it stays in Testing, only listed test users can sign in.
2. Create an OAuth client ID, application type Web application.
3. Authorized JavaScript origin: `https://pulleylab.zerocad.ai`
4. Authorized redirect URI: `https://pulleylab.zerocad.ai/api/google/callback`

Until both variables are set, the page keeps a small “Recover with checkout email” path. That path checks a Checkout session id or recovery code on the server. It is not shown once Google sign-in is configured.

`schema.sql` adds `accounts`, `auth_sessions`, `entitlements.google_sub`, and `designs.google_sub`. The API applies those statements on first use. Each statement is `IF NOT EXISTS`, except the access-window update, which only lengthens a deadline that is still shorter than 30 days from payment.

## Recovery

The buyer enters the email Stripe collected plus either the Checkout session id (`cs_…`) or a one-time code. The server checks the session against Stripe, or checks a hashed code. The code is not returned to the browser. This project does not include a mail provider, so a code is stored but not emailed until one is added; the session-id check works with the four variables above. Use this only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are unset.

## Local note

`npm run dev` serves the Vite app only. The `api/` routes run on Vercel. Without the four variables, download shows the $10 confirmation and Checkout stays on the page. The error toast names whichever of `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET` are unset. Checkout cannot start until the first three are set. Do not paste secrets into the repo. `.gitignore` already ignores `.env` files.
