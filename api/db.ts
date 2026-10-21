import { neon } from '@neondatabase/serverless';

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw Error('DATABASE_URL is not set');
  return neon(url);
}

export function configured() {
  return Boolean(process.env.DATABASE_URL && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}
