import { NextResponse } from 'next/server';
import { backendFetch, clearSession, isSameOrigin } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** Ends the session everywhere (the backend stamps the account), then clears this browser. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'So‘rov rad etildi' }, { status: 403 });
  }

  // The browser cookie is always cleared, even if the backend is unreachable — on a shared
  // device the person must be able to sign out locally. A backend failure is still reported so
  // the UI can say the server-side revocation did not happen.
  let failure: string | null = null;
  try {
    const upstream = await backendFetch('/api/auth/logout', { method: 'POST' });
    if (!upstream.ok && upstream.status !== 401) failure = 'Sessiyalarni serverda bekor qilib bo‘lmadi.';
  } catch (error: any) {
    if (error?.message !== 'NO_SESSION') failure = 'Server bilan aloqa uzildi.';
  }
  return clearSession(
    failure ? NextResponse.json({ ok: true, warning: failure }) : NextResponse.json({ ok: true })
  );
}
