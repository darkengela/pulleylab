import { neon } from '@neondatabase/serverless';

/** `neon()` is a tagged template. Call sites use `$1` placeholders, so they go through `query()`. */
export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw Error('DATABASE_URL is not set');
  const client = neon(url);
  return (text: string, params: unknown[] = []) => client.query(text, params as never[]);
}

