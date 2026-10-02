import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(rawToken: string): Buffer {
  return createHash('sha256').update(rawToken, 'utf8').digest();
}

export function tokensMatch(rawToken: string, hash: Buffer): boolean {
  const candidate = hashToken(rawToken);
  if (candidate.length !== hash.length) {
    return false;
  }
  return timingSafeEqual(candidate, hash);
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}
