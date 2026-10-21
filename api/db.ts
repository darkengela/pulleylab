import { neon } from '@neondatabase/serverless';

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw Error('DATABASE_URL is not set');
  return neon(url);
}

