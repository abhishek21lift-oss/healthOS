/**
 * Structured authentication security events.
 * Never includes passwords, raw tokens, session tokens, or health payloads.
 */
const FORBIDDEN_KEYS = new Set([
  'token',
  'password',
  'session_token',
  'sessionToken',
  'csrf',
  'csrf_token',
  'raw_token',
  'secret',
]);

/**
 * Structured authentication security events.
 * Never includes passwords, raw tokens, session tokens, or health payloads.
 */
export type AuthEventType =
  | 'registration_attempt'
  | 'registration_success'
  | 'registration_failure'
  | 'email_verification_requested'
  | 'email_verification_success'
  | 'email_verification_failure'
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'session_created'
  | 'session_rotated'
  | 'session_revoked'
  | 'invitation_created'
  | 'invitation_claim_success'
  | 'invitation_claim_failure'
  | 'rate_limited'
  | 'suspicious_replay';

export interface AuthSecurityEvent {
  readonly eventType: AuthEventType;
  readonly accountId?: string | null;
  readonly principalType?: 'person' | 'professional' | 'system' | null;
  readonly principalId?: string | null;
  /** Non-secret hint (e.g. email domain or account id), never raw tokens. */
  readonly contactHint?: string | null;
  readonly ipHint?: string | null;
  readonly requestId?: string | null;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export function assertNoSecrets(event: AuthSecurityEvent): void {
  const meta = event.metadata ?? {};
  for (const key of Object.keys(meta)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`auth event metadata must not include secret field: ${key}`);
    }
  }
}

export function contactHintFromEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return 'redacted';
  }
  const domain = email.slice(at + 1);
  const local = email.slice(0, at);
  const prefix = local.slice(0, 2);
  return `${prefix}***@${domain}`;
}
