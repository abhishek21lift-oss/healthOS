/**
 * Authentication services: registration, verification, login, logout,
 * session lifecycle, invitation claim primitives.
 *
 * Answers "who are you?" only — never "what health data may you access?"
 * Health authorization remains AccessGrant + consent + purpose + RLS (Phase 2/5).
 *
 * All identity-table access runs as trusted `system` principal under FORCE RLS.
 */

import { DomainError, personId as toPersonId } from '@health-os/domain';
import {
  beginRequest,
  beginSystemContext,
  clearRequest,
  runInPrincipalContext,
  runInSystemContext,
  withClient,
} from '@health-os/database';
import { assertAdult } from './age.js';
import { normalizeEmail } from './contact.js';
import { generateCsrfToken, generateToken, hashToken } from './tokens.js';
import { dummyVerify, hashPassword, validatePasswordPolicy, verifyPassword } from './password.js';
import {
  computeSessionLifetime,
  isSessionActive,
  MAX_FAILED_LOGINS,
  LOCKOUT_MS,
  SESSION_IDLE_MS,
  VERIFICATION_TOKEN_MS,
} from './session-policy.js';
import { assertNoSecrets, contactHintFromEmail } from './security-events.js';
import { AUTH_RATE_LIMITS, RateLimiter, rateLimitKey } from './rate-limit.js';
import type { PersonId } from '@health-os/domain';
import type { Pool, PoolClient, PrincipalContext } from '@health-os/database';
import type { AuthSecurityEvent } from './security-events.js';

const GENERIC_AUTH_FAILURE = 'Unable to sign in';
function emit(deps: AuthDeps, event: AuthSecurityEvent) {
  assertNoSecrets(event);
  deps.onSecurityEvent?.(event);
}
const defaultLimiter = new RateLimiter();
function requireLimiter(deps: AuthDeps) {
  return deps.limiter ?? defaultLimiter;
}
function nowDate(deps: AuthDeps) {
  return deps.now ? deps.now() : new Date();
}
function limitOrFail(
  deps: AuthDeps,
  meta: RequestMeta,
  endpoint: keyof typeof AUTH_RATE_LIMITS,
  scope: string,
) {
  const limiter = requireLimiter(deps);
  const decision = limiter.check({
    key: rateLimitKey(endpoint, scope),
    limit: AUTH_RATE_LIMITS[endpoint].limit,
    windowMs: AUTH_RATE_LIMITS[endpoint].windowMs,
  });
  if (!decision.allowed) {
    emit(deps, {
      eventType: 'rate_limited',
      contactHint: scope.includes('@') ? contactHintFromEmail(scope) : null,
      ipHint: meta.ipHint ?? null,
      requestId: meta.requestId ?? null,
      metadata: { endpoint },
    });
    throw new AuthError('rate_limited', 'Too many requests');
  }
}
async function loadAccountByEmail(client: PoolClient, email: string) {
  const res = await client.query<{ account_id: string; password_hash: string; status: string; email_verified_at: Date | string | null; failed_login_count: number; locked_until: Date | string | null; person_id: string | null; professional_id: string | null }>(
    `SELECT account_id, password_hash, status, email_verified_at,
            failed_login_count, locked_until, person_id, professional_id
     FROM accounts WHERE email_normalized = $1`,
    [email],
  );
  return res.rows[0] ?? null;
}

export type { AuthSecurityEvent };

export type AuthFailureCode =
  | 'invalid_credentials'
  | 'account_not_verified'
  | 'account_locked'
  | 'rate_limited'
  | 'under_18'
  | 'duplicate_identity'
  | 'invalid_token'
  | 'expired_token'
  | 'wrong_recipient'
  | 'invitation_unavailable'
  | 'validation';

export class AuthError extends Error {
  readonly code: AuthFailureCode;
  /** External message is always generic for credential failures (enumeration resistance). */
  readonly externalMessage: string;
  constructor(
    code: AuthFailureCode,
    externalMessage: string,
    options?: {
      cause?: unknown;
    },
  ) {
    super(externalMessage, options);
    this.name = 'AuthError';
    this.code = code;
    this.externalMessage = externalMessage;
  }
}

export interface AuthDeps {
  readonly pool: Pool;
  readonly limiter?: RateLimiter;
  readonly now?: () => Date;
  readonly onSecurityEvent?: (event: AuthSecurityEvent) => void;
}

export interface RequestMeta {
  readonly ipHint?: string | null;
  readonly requestId?: string | null;
  readonly originHeader?: string | null;
}

export interface RegistrationInput {
  readonly email: string;
  readonly password: string;
  readonly birthDate: string;
}

export interface IssuedSession {
  readonly sessionId: string;
  /** Return to client once; never store or log raw. */
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly accountId: string;
  readonly expiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly personId: string | null;
  readonly professionalId: string | null;
}

export interface AuthenticatedPrincipal {
  readonly accountId: string;
  readonly personId: string | null;
  readonly professionalId: string | null;
  readonly emailNormalized: string;
  readonly status: string;
}

export async function registerAccount(
  deps: AuthDeps,
  input: RegistrationInput,
  meta: RequestMeta = {},
): Promise<{
  accountId: string;
  verificationToken: string;
}> {
  const email = normalizeEmail(input.email);
  limitOrFail(deps, meta, 'registrationPerIp', meta.ipHint ?? 'unknown-ip');
  limitOrFail(deps, meta, 'registrationPerEmail', email);
  emit(deps, {
    eventType: 'registration_attempt',
    contactHint: contactHintFromEmail(email),
    ipHint: meta.ipHint ?? null,
    requestId: meta.requestId ?? null,
  });
  try {
    validatePasswordPolicy(input.password);
    const birth = new Date(`${input.birthDate}T00:00:00.000Z`);
    assertAdult(birth, nowDate(deps));
    const passwordHash = await hashPassword(input.password);
    const verificationToken = generateToken();
    const tokenHash = hashToken(verificationToken);
    const now = nowDate(deps);
    const expires = new Date(now.getTime() + VERIFICATION_TOKEN_MS);
    const accountId = await runInSystemContext(deps.pool, 'auth:register', async (client) => {
      const existing = await client.query(
        'SELECT account_id FROM accounts WHERE email_normalized = $1',
        [email],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw new AuthError('duplicate_identity', 'Unable to register');
      }
      const person = await client.query<{ person_id: string }>(
        `INSERT INTO persons (display_name, is_adult) VALUES ($1, true) RETURNING person_id`, 
        [email.split('@')[0] ?? 'person'],
      );
      const newPersonId = person.rows[0]?.person_id ?? '';
      const acc = await client.query<{ account_id: string }>(
        `INSERT INTO accounts (
           email_normalized, email_display, password_hash, status,
           birth_date, person_id
         ) VALUES ($1, $2, $3, 'pending_verification', $4::date, $5)
         RETURNING account_id`,
        [email, input.email.trim(), passwordHash, input.birthDate, newPersonId],
      );
      const id = acc.rows[0]?.account_id ?? '';
      await client.query(
        `INSERT INTO contact_points (kind, normalized_value, person_id, account_id, verified_at)
         VALUES ('email', $1, $2, $3, NULL)`,
        [email, newPersonId, id],
      );
      await client.query(
        `INSERT INTO email_verification_tokens (account_id, token_hash, purpose, issued_at, expires_at)
         VALUES ($1, $2, 'email_verify', $3, $4)`,
        [id, tokenHash, now, expires],
      );
      return id;
    });
    emit(deps, {
      eventType: 'registration_success',
      accountId,
      contactHint: contactHintFromEmail(email),
      ipHint: meta.ipHint ?? null,
      requestId: meta.requestId ?? null,
    });
    return { accountId, verificationToken };
  } catch (error) {
    if (error instanceof AuthError) {
      emit(deps, {
        eventType: 'registration_failure',
        contactHint: contactHintFromEmail(email),
        ipHint: meta.ipHint ?? null,
        requestId: meta.requestId ?? null,
        metadata: { reason: error.code },
      });
      throw error;
    }
    if (error instanceof DomainError && error.details.reason === 'under_18') {
      emit(deps, {
        eventType: 'registration_failure',
        contactHint: contactHintFromEmail(email),
        ipHint: meta.ipHint ?? null,
        requestId: meta.requestId ?? null,
        metadata: { reason: 'under_18' },
      });
      throw new AuthError('under_18', 'Unable to register');
    }
    emit(deps, {
      eventType: 'registration_failure',
      contactHint: contactHintFromEmail(email),
      ipHint: meta.ipHint ?? null,
      requestId: meta.requestId ?? null,
      metadata: { reason: error instanceof AuthError ? error.code : 'error' },
    });
    if (error instanceof DomainError) {
      throw new AuthError('validation', 'Unable to register', { cause: error });
    }
    throw new AuthError('validation', 'Unable to register', { cause: error });
  }
}

export async function verifyEmail(
  deps: AuthDeps,
  input: {
    readonly token: string;
  },
  meta: RequestMeta = {},
): Promise<{
  accountId: string;
}> {
  const tokenHash = hashToken(input.token);
  const now = nowDate(deps);
  const result = await runInSystemContext(deps.pool, 'auth:verify_email', async (client) => {
    const found = await client.query<{ verification_id: string; account_id: string; expires_at: Date | string; consumed_at: Date | string | null }>(
      `SELECT verification_id, account_id, expires_at, consumed_at
       FROM email_verification_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = found.rows[0];
    if (found.rowCount === 0 || row === undefined) {
      emit(deps, {
        eventType: 'email_verification_failure',
        requestId: meta.requestId ?? null,
        metadata: { reason: 'invalid' },
      });
      throw new AuthError('invalid_token', 'Invalid or expired link');
    }
    if (row.consumed_at !== null) {
      emit(deps, {
        eventType: 'suspicious_replay',
        accountId: row.account_id,
        requestId: meta.requestId ?? null,
        metadata: { kind: 'email_verification' },
      });
      throw new AuthError('invalid_token', 'Invalid or expired link');
    }
    if (now.getTime() > new Date(row.expires_at).getTime()) {
      emit(deps, {
        eventType: 'email_verification_failure',
        accountId: row.account_id,
        requestId: meta.requestId ?? null,
        metadata: { reason: 'expired' },
      });
      throw new AuthError('expired_token', 'Invalid or expired link');
    }
    const consumed = await client.query(
      `UPDATE email_verification_tokens
       SET consumed_at = $1
       WHERE verification_id = $2 AND consumed_at IS NULL`,
      [now, row.verification_id],
    );
    if (consumed.rowCount !== 1) {
      throw new AuthError('invalid_token', 'Invalid or expired link');
    }
    await client.query(
      `UPDATE accounts
       SET status = 'active', email_verified_at = $1, updated_at = $1, failed_login_count = 0
       WHERE account_id = $2`,
      [now, row.account_id],
    );
    await client.query(
      `UPDATE contact_points
       SET verified_at = $1
       WHERE account_id = $2 AND kind = 'email' AND verified_at IS NULL`,
      [now, row.account_id],
    );
    return { accountId: row.account_id };
  });
  emit(deps, {
    eventType: 'email_verification_success',
    accountId: result.accountId,
    requestId: meta.requestId ?? null,
  });
  return result;
}

export async function login(
  deps: AuthDeps,
  input: {
    readonly email: string;
    readonly password: string;
  },
  meta: RequestMeta = {},
): Promise<IssuedSession> {
  const email = normalizeEmail(input.email);
  limitOrFail(deps, meta, 'loginPerIp', meta.ipHint ?? 'unknown-ip');
  limitOrFail(deps, meta, 'loginPerEmail', email);
  const now = nowDate(deps);
  const fail = (
    reason: 'unknown_account' | 'bad_password' | 'not_verified',
    accountId?: string | null,
  ) => {
    emit(deps, {
      eventType: 'login_failure',
      accountId: accountId ?? null,
      contactHint: contactHintFromEmail(email),
      ipHint: meta.ipHint ?? null,
      requestId: meta.requestId ?? null,
      metadata: { reason },
    });
    throw new AuthError('invalid_credentials', GENERIC_AUTH_FAILURE);
  };
  return runInSystemContext(deps.pool, 'auth:login', async (client) => {
    const account = await loadAccountByEmail(client, email);
    if (account === null) {
      await dummyVerify(input.password);
      fail('unknown_account');
      throw new AuthError('invalid_credentials', GENERIC_AUTH_FAILURE);
    }
    const row = account;
    if (row.locked_until !== null && now.getTime() < new Date(row.locked_until).getTime()) {
      emit(deps, {
        eventType: 'login_failure',
        accountId: row.account_id,
        contactHint: contactHintFromEmail(email),
        ipHint: meta.ipHint ?? null,
        requestId: meta.requestId ?? null,
        metadata: { reason: 'locked' },
      });
      throw new AuthError('account_locked', GENERIC_AUTH_FAILURE);
    }
    const ok = await verifyPassword(input.password, row.password_hash);
    if (!ok) {
      const failed = row.failed_login_count + 1;
      const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCKOUT_MS) : null;
      await client.query(
        `UPDATE accounts
         SET failed_login_count = $1,
             locked_until = $2,
             updated_at = $3
         WHERE account_id = $4`,
        [failed, lockedUntil, now, row.account_id],
      );
      fail('bad_password', row.account_id);
    }
    if (row.status !== 'active' || row.email_verified_at === null) {
      fail('not_verified', row.account_id);
    }
    // Fixation defense: always mint a brand-new session identity at authentication.
    const lifetime = computeSessionLifetime(now);
    const sessionToken = generateToken();
    const csrfToken = generateCsrfToken();
    const tokenHash = hashToken(sessionToken);
    const sess = await client.query<{ session_id: string }>(
      `INSERT INTO sessions (
         account_id, token_hash, csrf_token, created_at, last_seen_at,
         authenticated_at, expires_at, absolute_expires_at
       ) VALUES ($1, $2, $3, $4, $4, $4, $5, $6)
       RETURNING session_id`,
      [
        row.account_id,
        tokenHash,
        csrfToken,
        now,
        lifetime.idleExpiresAt,
        lifetime.absoluteExpiresAt,
      ],
    );
    const sessionId = sess.rows[0]?.session_id ?? '';
    await client.query(
      `UPDATE accounts SET failed_login_count = 0, locked_until = NULL, updated_at = $1
       WHERE account_id = $2`,
      [now, row.account_id],
    );
    await client.query(
      `INSERT INTO auth_security_events (
         event_type, account_id, ip_hint, request_id, metadata
       ) VALUES ('session_created', $1, $2, $3, $4::jsonb)`,
      [row.account_id, meta.ipHint ?? null, meta.requestId ?? null, JSON.stringify({ sessionId })],
    );
    emit(deps, {
      eventType: 'login_success',
      accountId: row.account_id,
      contactHint: contactHintFromEmail(email),
      ipHint: meta.ipHint ?? null,
      requestId: meta.requestId ?? null,
    });
    return {
      sessionId,
      sessionToken,
      csrfToken,
      accountId: row.account_id,
      expiresAt: lifetime.idleExpiresAt,
      absoluteExpiresAt: lifetime.absoluteExpiresAt,
      personId: row.person_id,
      professionalId: row.professional_id,
    };
  });
}

export async function logout(
  deps: AuthDeps,
  input: {
    readonly sessionToken: string;
  },
  meta: RequestMeta = {},
): Promise<void> {
  const tokenHash = hashToken(input.sessionToken);
  await runInSystemContext(deps.pool, 'auth:logout', async (client) => {
    const res = await client.query<{ session_id: string; account_id: string }>(
      `UPDATE sessions
       SET revoked_at = $1
       WHERE token_hash = $2 AND revoked_at IS NULL
       RETURNING session_id, account_id`,
      [nowDate(deps), tokenHash],
    );
    const row = res.rows[0];
    if (row !== undefined) {
      await client.query(
        `INSERT INTO auth_security_events (event_type, account_id, ip_hint, request_id, metadata)
         VALUES ('logout', $1, $2, $3, $4::jsonb)`,
        [
          row.account_id,
          meta.ipHint ?? null,
          meta.requestId ?? null,
          JSON.stringify({ sessionId: row.session_id }),
        ],
      );
    }
  });
  emit(deps, {
    eventType: 'logout',
    ipHint: meta.ipHint ?? null,
    requestId: meta.requestId ?? null,
  });
}

export async function resolveSession(
  deps: AuthDeps,
  input: {
    readonly sessionToken: string;
  },
): Promise<AuthenticatedPrincipal | null> {
  const tokenHash = hashToken(input.sessionToken);
  const now = nowDate(deps);
  const outcome = await runInSystemContext<
    | { kind: 'invalid' }
    | { kind: 'idle_expired'; sessionId: string }
    | { kind: 'touch'; principal: AuthenticatedPrincipal }
  >(deps.pool, 'auth:resolve_session', async (client) => {
    const res = await client.query<{ session_id: string; account_id: string; expires_at: Date | string; absolute_expires_at: Date | string; revoked_at: Date | string | null; last_seen_at: Date | string; email_normalized: string; status: string; person_id: string | null; professional_id: string | null }>(
      `SELECT s.session_id, s.account_id, s.expires_at, s.absolute_expires_at,
                s.revoked_at, s.last_seen_at,
                a.email_normalized, a.status, a.person_id, a.professional_id
         FROM sessions s
         JOIN accounts a ON a.account_id = s.account_id
         WHERE s.token_hash = $1`,
      [tokenHash],
    );
    const row = res.rows[0];
    if (row === undefined) {
      return { kind: 'invalid' };
    }
    const active = isSessionActive(
      {
        expiresAt: new Date(row.expires_at),
        absoluteExpiresAt: new Date(row.absolute_expires_at),
        revokedAt: row.revoked_at,
      },
      now,
    );
    if (!active || row.status !== 'active') {
      return { kind: 'invalid' };
    }
    if (now.getTime() - new Date(row.last_seen_at).getTime() > SESSION_IDLE_MS) {
      await client.query(`UPDATE sessions SET revoked_at = $1 WHERE session_id = $2`, [
        now,
        row.session_id,
      ]);
      return { kind: 'idle_expired', sessionId: row.session_id };
    }
    await client.query(`UPDATE sessions SET last_seen_at = $1 WHERE session_id = $2`, [
      now,
      row.session_id,
    ]);
    return {
      kind: 'touch',
      principal: {
        accountId: row.account_id,
        personId: row.person_id,
        professionalId: row.professional_id,
        emailNormalized: row.email_normalized,
        status: row.status,
      },
    };
  });
  if (outcome.kind !== 'touch') {
    return null;
  }
  return outcome.principal;
}

/** Session fixation: rotate session id after privilege-relevant transitions (e.g. re-auth). */
export async function rotateSession(
  deps: AuthDeps,
  input: {
    readonly sessionToken: string;
  },
): Promise<IssuedSession> {
  const principal = await resolveSession(deps, input);
  if (principal === null) {
    throw new AuthError('invalid_credentials', GENERIC_AUTH_FAILURE);
  }
  const now = nowDate(deps);
  const lifetime = computeSessionLifetime(now);
  const sessionToken = generateToken();
  const csrfToken = generateCsrfToken();
  const tokenHash = hashToken(sessionToken);
  const previousHash = hashToken(input.sessionToken);
  const sessionId = await runInSystemContext(deps.pool, 'auth:rotate_session', async (client) => {
    const old = await client.query<{ session_id: string }>(
      `UPDATE sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL
         RETURNING session_id`,
      [now, previousHash],
    );
    const previousId = old.rows[0]?.session_id ?? null;
    const sess = await client.query<{ session_id: string }>(
      `INSERT INTO sessions (
           account_id, token_hash, csrf_token, created_at, last_seen_at,
           authenticated_at, expires_at, absolute_expires_at, rotated_from_session_id
         ) VALUES ($1, $2, $3, $4, $4, $4, $5, $6, $7)
         RETURNING session_id`,
      [
        principal.accountId,
        tokenHash,
        csrfToken,
        now,
        lifetime.idleExpiresAt,
        lifetime.absoluteExpiresAt,
        previousId,
      ],
    );
    const newId = sess.rows[0]?.session_id ?? '';
    await client.query(
      `INSERT INTO auth_security_events (event_type, account_id, metadata)
         VALUES ('session_rotated', $1, $2::jsonb)`,
      [principal.accountId, JSON.stringify({ sessionId: newId, previousId })],
    );
    return newId;
  });
  return {
    sessionId,
    sessionToken,
    csrfToken,
    accountId: principal.accountId,
    expiresAt: lifetime.idleExpiresAt,
    absoluteExpiresAt: lifetime.absoluteExpiresAt,
    personId: principal.personId,
    professionalId: principal.professionalId,
  };
}

export async function revokeSessionById(
  deps: AuthDeps,
  sessionId: string,
  meta: RequestMeta = {},
): Promise<void> {
  await runInSystemContext(deps.pool, 'auth:revoke_session', async (client) => {
    const res = await client.query<{ account_id: string }>(
      `UPDATE sessions SET revoked_at = $1 WHERE session_id = $2 AND revoked_at IS NULL
       RETURNING account_id`,
      [nowDate(deps), sessionId],
    );
    const accountId = res.rows[0]?.account_id;
    if (accountId !== undefined) {
      await client.query(
        `INSERT INTO auth_security_events (event_type, account_id, ip_hint, request_id, metadata)
         VALUES ('session_revoked', $1, $2, $3, $4::jsonb)`,
        [accountId, meta.ipHint ?? null, meta.requestId ?? null, JSON.stringify({ sessionId })],
      );
    }
  });
}

export interface InvitationClaimInput {
  readonly token: string;
  /** Authenticated claimant contact (must match invitation recipient). */
  readonly claimantEmail: string;
}

export interface InvitationClaimResult {
  readonly invitationId: string;
  readonly personId: PersonId;
  readonly createdNewPerson: boolean;
}

/**
 * Claim invitation: single-use, TTL, recipient-bound, duplicate-person safe (I-17).
 * Does NOT grant health access or consent.
 */
export async function claimInvitation(
  deps: AuthDeps,
  input: InvitationClaimInput,
  meta: RequestMeta = {},
): Promise<InvitationClaimResult> {
  const claimant = normalizeEmail(input.claimantEmail);
  limitOrFail(deps, meta, 'invitationClaimPerIp', meta.ipHint ?? 'unknown-ip');
  limitOrFail(deps, meta, 'invitationClaimPerContact', claimant);
  const tokenHash = hashToken(input.token);
  const now = nowDate(deps);
  try {
    const result = await runInSystemContext(deps.pool, 'auth:claim_invitation', async (client) => {
      const found = await client.query<{ invitation_id: string; status: string; expires_at: Date | string; contact_point: string; recipient_normalized: string | null; consumed_at: Date | string | null }>(
        `SELECT invitation_id, status, expires_at, contact_point,
                  recipient_normalized, consumed_at
           FROM invitations
           WHERE token_hash = $1`,
        [tokenHash],
      );
      const inv = found.rows[0];
      if (found.rowCount === 0 || inv === undefined) {
        throw new AuthError('invalid_token', 'Invitation is invalid or expired');
      }
      if (inv.consumed_at !== null || inv.status !== 'pending') {
        emit(deps, {
          eventType: 'suspicious_replay',
          requestId: meta.requestId ?? null,
          metadata: { kind: 'invitation' },
        });
        throw new AuthError('invitation_unavailable', 'Invitation is invalid or expired');
      }
      if (now.getTime() > new Date(inv.expires_at).getTime()) {
        throw new AuthError('expired_token', 'Invitation is invalid or expired');
      }
      const expected = inv.recipient_normalized ?? normalizeEmail(inv.contact_point);
      if (expected !== claimant) {
        emit(deps, {
          eventType: 'invitation_claim_failure',
          requestId: meta.requestId ?? null,
          ipHint: meta.ipHint ?? null,
          metadata: { reason: 'wrong_recipient' },
        });
        throw new AuthError('wrong_recipient', 'Invitation is invalid or expired');
      }
      const existingContact = await client.query<{ person_id: string; verified_at: Date | string | null }>(
        `SELECT person_id, verified_at FROM contact_points
           WHERE kind = 'email' AND normalized_value = $1 AND person_id IS NOT NULL`,
        [claimant],
      );
      let personId;
      let createdNewPerson = false;
      const prior = existingContact.rows[0];
      if (prior !== undefined) {
        // I-17: never fork an existing person on contact match.
        personId = toPersonId(prior.person_id);
      } else {
        const acc = await client.query<{ person_id: string | null }>(
          `SELECT person_id FROM accounts WHERE email_normalized = $1`,
          [claimant],
        );
        const accountPerson = acc.rows[0]?.person_id ?? null;
        if (accountPerson !== null) {
          personId = toPersonId(accountPerson);
          await client.query(
            `INSERT INTO contact_points (kind, normalized_value, person_id, verified_at)
               VALUES ('email', $1, $2, $3)
               ON CONFLICT (kind, normalized_value) DO NOTHING`,
            [claimant, personId, now],
          );
        } else {
          const person = await client.query<{ person_id: string }>(
            `INSERT INTO persons (display_name, is_adult) VALUES ($1, true) RETURNING person_id`,
            [claimant.split('@')[0] ?? 'person'],
          );
          personId = toPersonId(person.rows[0]?.person_id ?? '');
          createdNewPerson = true;
          await client.query(
            `INSERT INTO contact_points (kind, normalized_value, person_id, verified_at)
               VALUES ('email', $1, $2, $3)
               ON CONFLICT (kind, normalized_value) DO NOTHING`,
            [claimant, personId, now],
          );
        }
      }
      const accepted = await client.query<{ invitation_id: string }>(
        `UPDATE invitations
           SET status = 'accepted', consumed_at = $1, claimed_person_id = $2
           WHERE invitation_id = $3 AND status = 'pending' AND consumed_at IS NULL
           RETURNING invitation_id`,
        [now, personId, inv.invitation_id],
      );
      if (accepted.rowCount !== 1) {
        throw new AuthError('invitation_unavailable', 'Invitation is invalid or expired');
      }
      await client.query(
        `INSERT INTO auth_security_events (event_type, contact_hint, ip_hint, request_id, metadata)
           VALUES ('invitation_claim_success', $1, $2, $3, $4::jsonb)`,
        [
          contactHintFromEmail(claimant),
          meta.ipHint ?? null,
          meta.requestId ?? null,
          JSON.stringify({ invitationId: inv.invitation_id, createdNewPerson }),
        ],
      );
      return {
        invitationId: inv.invitation_id,
        personId: personId,
        createdNewPerson,
      };
    });
    return result;
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code !== 'wrong_recipient') {
        emit(deps, {
          eventType: 'invitation_claim_failure',
          ipHint: meta.ipHint ?? null,
          requestId: meta.requestId ?? null,
          metadata: { reason: error.code },
        });
      }
      throw error;
    }
    throw new AuthError('invalid_token', 'Invitation is invalid or expired', { cause: error });
  }
}

export interface CreateInvitationInput {
  readonly flow: 'person_first' | 'professional_first';
  readonly contactPoint: string;
  readonly invitedByProfessionalId: string | null;
  readonly organizationId?: string | null;
  readonly requestedCategories?: readonly string[];
  readonly ttlMs?: number;
}

export async function createInvitation(
  deps: AuthDeps,
  input: CreateInvitationInput,
  meta: RequestMeta = {},
): Promise<{
  invitationId: string;
  token: string;
}> {
  const contact = normalizeEmail(input.contactPoint);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = nowDate(deps);
  const ttl = input.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const expires = new Date(now.getTime() + ttl);
  const invitationId = await runInSystemContext(
    deps.pool,
    'auth:create_invitation',
    async (client) => {
      const res = await client.query<{ invitation_id: string }>(
        `INSERT INTO invitations (
           flow, status, contact_point, invited_by_professional_id, organization_id,
           requested_categories, issued_at, expires_at, token_hash, recipient_normalized
         ) VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING invitation_id`,
        [
          input.flow,
          contact,
          input.invitedByProfessionalId,
          input.organizationId ?? null,
          input.requestedCategories ?? [],
          now,
          expires,
          tokenHash,
          contact,
        ],
      );
      return res.rows[0]?.invitation_id ?? '';
    },
  );
  emit(deps, {
    eventType: 'invitation_created',
    contactHint: contactHintFromEmail(contact),
    ipHint: meta.ipHint ?? null,
    requestId: meta.requestId ?? null,
    metadata: { invitationId },
  });
  return { invitationId, token };
}

/**
 * Trusted DB principal context from an authenticated session.
 * Clients never choose principal_id/person_id/purpose for privileged context.
 */
export async function withSessionPrincipalContext<T>(
  deps: AuthDeps,
  sessionToken: string,
  purpose: string,
  fn: (client: PoolClient, principal: AuthenticatedPrincipal) => Promise<T>,
): Promise<T> {
  const principal = await resolveSession(deps, { sessionToken });
  if (principal === null) {
    throw new AuthError('invalid_credentials', GENERIC_AUTH_FAILURE);
  }
  if (purpose.trim().length === 0) {
    throw new AuthError('validation', 'purpose required');
  }
  const context = toPrincipalContext(principal, purpose);
  return runInPrincipalContext(deps.pool, context, (client) => fn(client, principal));
}

export function toPrincipalContext(
  principal: AuthenticatedPrincipal,
  purpose: string,
): PrincipalContext {
  if (principal.personId !== null) {
    return {
      principalType: 'person',
      principalId: principal.personId,
      purpose,
    };
  }
  if (principal.professionalId !== null) {
    return {
      principalType: 'professional',
      principalId: principal.professionalId,
      purpose,
    };
  }
  // Account without person/professional link cannot act on health data via RLS.
  return {
    principalType: 'system',
    principalId: principal.accountId,
    purpose,
  };
}

export async function establishRequestContext(
  client: PoolClient,
  context: PrincipalContext,
): Promise<string> {
  const requestId = await beginRequest(client, context);
  return requestId;
}

export async function enterSystemContext(client: PoolClient, purpose: string): Promise<string> {
  return beginSystemContext(client, purpose);
}

export async function clearRequestContext(client: PoolClient): Promise<void> {
  await clearRequest(client);
}

export type { PersonId };

export { withClient };
