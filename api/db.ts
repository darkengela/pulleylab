import { neon } from '@neondatabase/serverless';

/** Comments and blank lines dropped so each statement can run on its own. */
export function schemaStatements(source: string) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Kept identical to schema.sql. Checkout applies it once per instance before the first query. */
export const SCHEMA_SQL = `
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
`;

let ready: Promise<void> | undefined;

/** `neon()` is a tagged template. Call sites use `$1` placeholders, so they go through `query()`. */
export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw Error('DATABASE_URL is not set');
  const client = neon(url);
  const query = (text: string, params: unknown[] = []) => client.query(text, params as never[]);
  return async (text: string, params: unknown[] = []) => {
    await ensureSchema(query);
    return query(text, params);
  };
}

function ensureSchema(query: (text: string, params?: unknown[]) => Promise<unknown>) {
  if (ready) return ready;
  let pending: Promise<void>;
  pending = (async () => {
    for (const statement of schemaStatements(SCHEMA_SQL)) await query(statement);
  })().catch((error: unknown) => {
    if (ready === pending) ready = undefined;
    throw error;
  });
  ready = pending;
  return pending;
}
