import { NextResponse } from 'next/server';
import { PAIR_COOKIE, isSameOrigin, publicBackendFetch, sessionCookieOptions } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * Opens a login pairing request. The pairing token comes back into an httpOnly cookie rather
 * than into the page: the browser needs to *poll* with it, not to read it, and a token sitting
 * in JavaScript is a token an injected script can carry off and redeem elsewhere.
 */
export async function POST(request: Request) {
  if (!(await isSameOrigin(request))) {
    return NextResponse.json({ error: 'So‘rov rad etildi' }, { status: 403 });
  }

  try {
    const upstream = await publicBackendFetch('/api/auth/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forwarded so the approval message in the bot can describe the device asking.
        'user-agent': request.headers.get('user-agent') || '',
      },
      body: '{}',
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return NextResponse.json({ error: data?.error || 'Xatolik yuz berdi' }, { status: upstream.status });
    }

    const response = NextResponse.json({
      pairCode: data.pairCode,
      deepLink: data.deepLink,
      expiresAt: data.expiresAt,
    });
    response.cookies.set(PAIR_COOKIE, data.token, sessionCookieOptions(10 * 60));
    return response;
  } catch {
    return NextResponse.json({ error: 'Server bilan bog‘lanib bo‘lmadi' }, { status: 502 });
  }
}
