import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newGrant() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashGrant(token) };
}

export function hashGrant(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function grantHashEquals(stored: string, token: string) {
  const hash = hashGrant(token);
  const a = Buffer.from(stored);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
