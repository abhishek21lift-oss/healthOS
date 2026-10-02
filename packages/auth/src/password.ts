import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { invalidValue } from '@health-os/domain';

type ScryptAsync = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;
const scryptAsync = promisify(scrypt) as ScryptAsync;
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 32;
const MAX_PASSWORD_LEN = 1024;
const MIN_PASSWORD_LEN = 12;

export function validatePasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LEN) {
    throw invalidValue('Password', 'too_short');
  }
  if (password.length > MAX_PASSWORD_LEN) {
    throw invalidValue('Password', 'too_long');
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordPolicy(password);
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${String(N)}$${String(R)}$${String(P)}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LEN) {
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const N = Number(parts[1]);
  const R = Number(parts[2]);
  const P = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) {
    return false;
  }
  if (N < 1024 || N > 1_048_576 || R < 1 || R > 32 || P < 1 || P > 16) {
    return false;
  }
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4] ?? '', 'base64');
    expected = Buffer.from(parts[5] ?? '', 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const derived = await scryptAsync(password, salt, expected.length, { N, r: R, p: P });
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

/** Constant-work failure path: still run a hash verify against a dummy when account missing. */
export async function dummyVerify(password: string): Promise<false> {
  const dummy =
    'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=$' +
    Buffer.alloc(64).toString('base64');
  await verifyPassword(password, dummy);
  return false;
}
