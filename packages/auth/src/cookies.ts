/**
 * Session cookie helpers. Production defaults: Secure, HttpOnly, SameSite=Lax.
 * Secure=false is never the production default.
 */
export interface SessionCookieOptions {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'Strict' | 'Lax' | 'None';
  readonly path: string;
  readonly maxAgeSeconds: number;
}

export const SESSION_COOKIE_NAME = 'health_os_session';

export const CSRF_COOKIE_NAME = 'health_os_csrf';

export const CSRF_HEADER_NAME = 'x-csrf-token';

export function productionSessionCookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAgeSeconds,
  };
}

export function serializeCookie(
  name: string,
  value: string,
  options: SessionCookieOptions,
): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('invalid cookie name');
  }
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${String(options.maxAgeSeconds)}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function sessionCookieIsSecure(options: SessionCookieOptions): boolean {
  return options.secure && options.httpOnly && options.sameSite !== 'None';
}
