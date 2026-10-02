/**
 * In-memory sliding-window rate limiter for authentication endpoints.
 * Minimum secure abstraction; later infra can replace with Redis-backed store.
 */
export interface RateLimitRule {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}

export type RateLimitDecision =
  | {
      readonly allowed: true;
      readonly remaining: number;
    }
  | {
      readonly allowed: false;
      readonly retryAfterMs: number;
      readonly remaining: 0;
    };

export class RateLimiter {
  private readonly buckets = new Map<string, { hits: number[] }>();
  private readonly maxKeys;
  constructor(maxKeys = 10_000) {
    this.maxKeys = maxKeys;
  }
  check(rule: RateLimitRule, now: number = Date.now()): RateLimitDecision {
    const cutoff = now - rule.windowMs;
    const existing = this.buckets.get(rule.key);
    const hits = (existing?.hits ?? []).filter((t) => t > cutoff);
    if (hits.length >= rule.limit) {
      const oldest = hits[0] ?? now;
      this.buckets.set(rule.key, { hits });
      return {
        allowed: false,
        retryAfterMs: Math.max(0, oldest + rule.windowMs - now),
        remaining: 0,
      };
    }
    hits.push(now);
    if (this.buckets.size >= this.maxKeys && !this.buckets.has(rule.key)) {
      this.prune(now);
    }
    this.buckets.set(rule.key, { hits });
    return { allowed: true, remaining: rule.limit - hits.length };
  }
  reset(key?: string): void {
    if (key === undefined) {
      this.buckets.clear();
    } else {
      this.buckets.delete(key);
    }
  }
  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.hits.length === 0 || bucket.hits.every((t) => t <= now - 3_600_000)) {
        this.buckets.delete(key);
      }
    }
  }
}

/** Documented Phase 3 limits (see AUTHENTICATION-ARCHITECTURE.md). */
export const AUTH_RATE_LIMITS: {
  readonly registrationPerIp: {
    readonly limit: 5;
    readonly windowMs: number;
  };
  readonly registrationPerEmail: {
    readonly limit: 3;
    readonly windowMs: number;
  };
  readonly loginPerIp: {
    readonly limit: 20;
    readonly windowMs: number;
  };
  readonly loginPerEmail: {
    readonly limit: 5;
    readonly windowMs: number;
  };
  readonly verificationPerEmail: {
    readonly limit: 10;
    readonly windowMs: number;
  };
  readonly invitationClaimPerIp: {
    readonly limit: 10;
    readonly windowMs: number;
  };
  readonly invitationClaimPerContact: {
    readonly limit: 5;
    readonly windowMs: number;
  };
} = {
  registrationPerIp: { limit: 5, windowMs: 60 * 60 * 1000 },
  registrationPerEmail: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
  loginPerIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  loginPerEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
  verificationPerEmail: { limit: 10, windowMs: 60 * 60 * 1000 },
  invitationClaimPerIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  invitationClaimPerContact: { limit: 5, windowMs: 60 * 60 * 1000 },
};

export function rateLimitKey(endpoint: string, scope: string): string {
  return `${endpoint}:${scope}`;
}
