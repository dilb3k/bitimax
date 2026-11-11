import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  PAIR_COOKIE,
  SESSION_COOKIE,
  USER_COOKIE,
  publicBackendFetch,
  sessionCookieOptions,
} from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Asks the backend whether the pairing request has been approved in the bot yet, and — the one
 * moment it matters — turns an approval into this browser's session cookie.
 */
export async function GET() {
  const pairToken = (await cookies()).get(PAIR_COOKIE)?.value;
  if (!pairToken) return NextResponse.json({ status: 'expired' });

  try {
    const upstream = await publicBackendFetch(`/api/auth/poll?token=${encodeURIComponent(pairToken)}`);
    const data = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json({ status: data?.status || 'error', error: data?.error }, { status: upstream.status });
    }
    if (data.status !== 'approved') {
      return NextResponse.json({ status: data.status });
    }

    const response = NextResponse.json({ status: 'approved', user: data.user });
    response.cookies.set(SESSION_COOKIE, data.session, sessionCookieOptions(data.expiresIn));
    // Same lifetime, but readable: it holds only what the header renders (name, role) and is
    // never trusted for a permission decision — every one of those is made by the backend
    // from the signed token.
    response.cookies.set(
      USER_COOKIE,
      // Not pre-encoded: the cookie API percent-encodes the value itself, and encoding twice
      // leaves the browser holding a string that decodes to more escapes rather than JSON.
      JSON.stringify({
        name: data.user?.firstName || data.user?.username || 'Foydalanuvchi',
        role: data.user?.role || 'buyer',
      }),
      { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: data.expiresIn }
    );
    // One pairing token, one session.
    response.cookies.set(PAIR_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ status: 'error', error: 'Server bilan bog‘lanib bo‘lmadi' }, { status: 502 });
  }
}
