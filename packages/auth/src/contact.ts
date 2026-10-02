import { invalidValue } from '@health-os/domain';

const EMAIL_MAX = 254;
const EMAIL_MIN = 3;

export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < EMAIL_MIN || trimmed.length > EMAIL_MAX) {
    throw invalidValue('Email', 'invalid_length');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw invalidValue('Email', 'invalid_format');
  }
  if (trimmed.includes('..')) {
    throw invalidValue('Email', 'consecutive_dots');
  }
  return trimmed;
}

export function emailsEqual(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}
