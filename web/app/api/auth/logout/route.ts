import { NextResponse } from 'next/server';
import { backendFetch, clearSession, isSameOrigin } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Ends the session everywhere (the backend stamps the account), then clears this browser. */
export async function POST(request: Request) {
  if (!(await isSameOrigin(request))) {
    return NextResponse.json({ error: 'So‘rov rad etildi' }, { status: 403 });
  }

  try {
    const upstream = await backendFetch('/api/auth/logout', { method: 'POST' });
    if (!upstream.ok && upstream.status !== 401) {
      return NextResponse.json({ error: 'Sessiyalarni bekor qilib bo‘lmadi. Qayta urinib ko‘ring.' }, { status: 502 });
    }
  } catch (error: any) {
    if (error?.message !== 'NO_SESSION') return NextResponse.json({ error: 'Server bilan aloqa uzildi. Qayta urinib ko‘ring.' }, { status: 502 });
  }
  return clearSession(NextResponse.json({ ok: true }));
}
