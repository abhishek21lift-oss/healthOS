import { invalidValue } from '@health-os/domain';

export const MIN_AGE_YEARS = 18;

export function ageOn(birthDate: Date, at: Date): number {
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function assertAdult(birthDate: Date, at: Date = new Date()): void {
  if (Number.isNaN(birthDate.getTime())) {
    throw invalidValue('AgeGate', 'invalid_birth_date');
  }
  if (birthDate.getTime() > at.getTime()) {
    throw invalidValue('AgeGate', 'birth_date_in_future');
  }
  if (ageOn(birthDate, at) < MIN_AGE_YEARS) {
    throw invalidValue('AgeGate', 'under_18');
  }
}

export function isAdult(birthDate: Date, at: Date = new Date()): boolean {
  try {
    assertAdult(birthDate, at);
    return true;
  } catch {
    return false;
  }
}
