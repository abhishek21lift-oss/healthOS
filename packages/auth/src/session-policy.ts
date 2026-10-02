import { invalidValue } from '@health-os/domain';

export const SESSION_IDLE_MS: number = 30 * 60 * 1000;

export const SESSION_ABSOLUTE_MS: number = 12 * 60 * 60 * 1000;

export const VERIFICATION_TOKEN_MS: number = 24 * 60 * 60 * 1000;

export const INVITATION_TOKEN_MS: number = 7 * 24 * 60 * 60 * 1000;

export const MAX_FAILED_LOGINS = 5;

export const LOCKOUT_MS: number = 15 * 60 * 1000;

export interface SessionLifetime {
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export function computeSessionLifetime(now: Date = new Date()): SessionLifetime {
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  return { idleExpiresAt, absoluteExpiresAt };
}

export function isSessionActive(
  session: {
    readonly expiresAt: Date;
    readonly absoluteExpiresAt: Date;
    readonly revokedAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (session.revokedAt !== null) {
    return false;
  }
  if (now.getTime() > session.expiresAt.getTime()) {
    return false;
  }
  if (now.getTime() > session.absoluteExpiresAt.getTime()) {
    return false;
  }
  return true;
}

export function assertPasswordLoginInput(email: string, password: string): void {
  if (email.trim().length === 0) {
    throw invalidValue('Login', 'email_required');
  }
  if (password.length === 0) {
    throw invalidValue('Login', 'password_required');
  }
}
