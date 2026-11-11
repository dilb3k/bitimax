import 'server-only';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Server-side session plumbing. The browser never holds the backend session token in
 * JavaScript-readable form: it lives in an httpOnly cookie, and these route handlers are the
 * only thing that turns it into an `Authorization` header on the way to the API.
 *
 * That arrangement is what makes an XSS bug survivable — injected script can call this
 * origin's endpoints (which SameSite and the origin check below already constrain) but it
 * cannot read the token, copy it out, or use it after the tab is closed.
 */

export const SESSION_COOKIE = 'bx_session';
export const PAIR_COOKIE = 'bx_pair';
/** Display-only mirror, readable by the client so the header knows which links to show. */
export const USER_COOKIE = 'bx_user';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Proves to the API that the call comes from this site's server, and tells it which visitor
 * is behind it (for rate limits and the "who is logging in" alert in the bot). The key is the
 * shared WEB_PROXY_KEY secret; it never reaches the browser.
 */
function backendIdentity(): Record<string, string> {
  const out: Record<string, string> = {};
  const key = process.env.WEB_PROXY_KEY;
  if (key) out['x-web-key'] = key;
  const forwarded = headers().get('x-forwarded-for')?.split(',')[0]?.trim() || headers().get('x-real-ip') || '';
  if (forwarded) out['x-client-ip'] = forwarded;
  return out;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Lax, not Strict: a link from the Telegram bot into the cabinet should land signed in.
    // Lax still withholds the cookie from cross-site POSTs, which is the CSRF case that matters.
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function getSessionToken(): string | null {
  return cookies().get(SESSION_COOKIE)?.value || null;
}

/**
 * Rejects state-changing requests that did not originate from this site.
 *
 * SameSite=Lax already blocks the cross-site form POST, but it is one flag away from being
 * disabled and says nothing about a same-site subdomain. Comparing Origin against the host we
 * are actually serving costs nothing and fails closed when the header is missing on a
 * mutation, which no real browser does.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = headers().get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function unauthorized(message = 'Avvalo tizimga kiring') {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** Calls the backend with the caller's session attached. Never reachable without one. */
export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  if (!token) throw new Error('NO_SESSION');

  const requestHeaders = new Headers(init.headers);
  requestHeaders.set('Authorization', `Bearer ${token}`);
  for (const [name, value] of Object.entries(backendIdentity())) requestHeaders.set(name, value);

  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: requestHeaders,
    cache: 'no-store',
    signal: init.signal || AbortSignal.timeout(25000),
  });
}

/** Unauthenticated backend call (login pairing endpoints). */
export function publicBackendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const requestHeaders = new Headers(init.headers);
  for (const [name, value] of Object.entries(backendIdentity())) requestHeaders.set(name, value);
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers: requestHeaders, cache: 'no-store', signal: init.signal || AbortSignal.timeout(25000) });
}

export function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
  response.cookies.set(USER_COOKIE, '', { httpOnly: false, sameSite: 'lax', secure: isProd, path: '/', maxAge: 0 });
  response.cookies.set(PAIR_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
  return response;
}
