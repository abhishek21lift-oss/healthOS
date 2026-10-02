/**
 * Connection factory for PostgreSQL (ADR-0008).
 * Three roles:
 * - migrator/superuser (tests/migrations): DDL only
 * - health_owner: schema owner, subject to FORCE RLS
 * - health_app: runtime role, NO BYPASSRLS, not owner
 */

import pg from 'pg';

const { Pool } = pg;

export type PrincipalType = 'person' | 'professional' | 'system';

export interface PrincipalContext {
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export interface PoolOptions {
  readonly connectionString: string;
  readonly max?: number;
}

export function createPool(options: PoolOptions): pg.Pool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5,
    // Fail closed: never silently fall back to another role.
    allowExitOnIdle: true,
  });
}

export function defaultTestDsn(role: 'postgres' | 'owner' | 'app'): string {
  const host = process.env.HEALTH_OS_PG_HOST ?? '127.0.0.1';
  const port = process.env.HEALTH_OS_PG_PORT ?? '5433';
  const db = process.env.HEALTH_OS_PG_DB ?? 'health_os_test';
  if (role === 'postgres') {
    const user = process.env.HEALTH_OS_PG_SUPERUSER ?? 'postgres';
    const password = process.env.HEALTH_OS_PG_SUPERUSER_PASSWORD ?? 'postgres_test_pw';
    return `postgresql://${user}:${password}@${host}:${port}/${db}`;
  }
  if (role === 'owner') {
    const user = process.env.HEALTH_OS_PG_OWNER ?? 'health_owner';
    const password = process.env.HEALTH_OS_PG_OWNER_PASSWORD ?? 'health_owner_dev_pw';
    return `postgresql://${user}:${password}@${host}:${port}/${db}`;
  }
  const user = process.env.HEALTH_OS_PG_APP ?? 'health_app';
  const password = process.env.HEALTH_OS_PG_APP_PASSWORD ?? 'health_app_dev_pw';
  return `postgresql://${user}:${password}@${host}:${port}/${db}`;
}

export type QueryResult<T extends pg.QueryResultRow = pg.QueryResultRow> = pg.QueryResult<T>;

/** Re-exported so consumers (auth) need not depend on `pg` directly. */
export type Pool = pg.Pool;

export type PoolClient = pg.PoolClient;

/**
 * Trusted identity/auth path: begin a transaction-local system principal context.
 * Always pair with clearRequest (or run inside a transaction that rolls back).
 */
export async function runInSystemContext<T>(
  pool: pg.Pool,
  purpose: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(pool, async (client) => {
    await client.query('BEGIN');
    try {
      await beginRequest(client, {
        principalType: 'system',
        principalId: '00000000-0000-0000-0000-000000000001',
        purpose,
      });
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}

/** Enter system context on an existing client (already BEGIN'd by caller). */
export async function beginSystemContext(client: pg.PoolClient, purpose: string): Promise<string> {
  return beginRequest(client, {
    principalType: 'system',
    principalId: '00000000-0000-0000-0000-000000000001',
    purpose,
  });
}

export async function withClient<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Trusted application layer sets transaction-local RLS context.
 * End clients never receive a raw pool (Phase 2: package boundary only).
 */
export async function beginRequest(
  client: pg.PoolClient,
  context: PrincipalContext,
): Promise<string> {
  const requestId = context.requestId ?? crypto.randomUUID();
  await client.query(`SELECT app_auth.begin_request($1::text, $2::uuid, $3::text, $4::uuid)`, [
    context.principalType,
    context.principalId,
    context.purpose,
    requestId,
  ]);
  return requestId;
}

export async function clearRequest(client: pg.PoolClient): Promise<void> {
  await client.query(`SELECT app_auth.clear_request()`);
}

export async function runInPrincipalContext<T>(
  pool: pg.Pool,
  context: PrincipalContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(pool, async (client) => {
    await client.query('BEGIN');
    try {
      await beginRequest(client, context);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await clearRequest(client);
    }
  });
}
