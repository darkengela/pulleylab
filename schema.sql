-- Apply once to the Neon database. Statements create missing tables and columns.
-- A $10 payment is 30 days of unlimited generation and download, measured from
-- entitlements.created_at. The update below extends an older 7-day fit window
-- to 30 days from that payment. It does not delete rows or change who paid.

CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  teeth INTEGER NOT NULL,
  parameters JSONB NOT NULL,
  email TEXT,
  step_blob_path TEXT,
  stl_blob_path TEXT,
  step_file_parameters JSONB,
  stl_file_parameters JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL REFERENCES designs (id),
  email TEXT,
  stripe_session_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders (id),
  design_id TEXT NOT NULL REFERENCES designs (id),
  email TEXT NOT NULL,
  profile TEXT NOT NULL,
  teeth INTEGER NOT NULL,
  parameters JSONB NOT NULL,
  adjustment_deadline TIMESTAMPTZ NOT NULL,
  grant_hash TEXT,
  grant_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements (id),
  parameters JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS entitlements_email_idx ON entitlements (email);
CREATE INDEX IF NOT EXISTS entitlements_grant_hash_idx ON entitlements (grant_hash);

ALTER TABLE designs ADD COLUMN IF NOT EXISTS step_blob_path TEXT;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS stl_blob_path TEXT;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS step_file_parameters JSONB;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS stl_file_parameters JSONB;

-- Verified Google account. Email is the address from the ID token, not a typed value.
CREATE TABLE IF NOT EXISTS accounts (
  google_sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE INDEX IF NOT EXISTS entitlements_google_sub_idx ON entitlements (google_sub);
CREATE INDEX IF NOT EXISTS accounts_email_idx ON accounts (email);

-- Saved generations belong to the verified Google account, not only the checkout row.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS google_sub TEXT;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS entitlement_id TEXT;
ALTER TABLE designs ADD COLUMN IF NOT EXISTS upload_grant_hash TEXT;
CREATE INDEX IF NOT EXISTS designs_google_sub_idx ON designs (google_sub);

UPDATE entitlements
SET adjustment_deadline = created_at + interval '30 days'
WHERE adjustment_deadline < created_at + interval '30 days';
