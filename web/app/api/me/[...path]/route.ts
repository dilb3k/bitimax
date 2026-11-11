import { NextResponse } from 'next/server';
import { backendFetch, isSameOrigin, unauthorized } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * The one door between the browser and the authenticated API.
 *
 * Everything the cabinet does goes through here, which is what lets the session token stay in
 * an httpOnly cookie and the backend's address stay off the public internet. Three checks
 * apply to every call:
 *
 *  1. a session must exist — no token, no upstream request;
 *  2. every path segment is `[A-Za-z0-9_-]`, so a crafted `../escrow/x/refund` cannot walk out
 *     of `/api/me/` into an internal route;
 *  3. state-changing methods must come from this origin (CSRF).
 */

const SEGMENT = /^[A-Za-z0-9_-]{1,48}$/;
const MAX_SEGMENTS = 4;
/** Only image bodies may be large; everything else is a small JSON document. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function buildPath(segments: string[], search: string): string | null {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return null;
  if (!segments.every((segment) => SEGMENT.test(segment))) return null;
  return `/api/me/${segments.join('/')}${search}`;
}

async function proxy(request: Request, segments: string[]) {
  const url = new URL(request.url);
  const path = buildPath(segments, url.search);
  if (!path) return NextResponse.json({ error: 'Noto‘g‘ri so‘rov' }, { status: 400 });

  const method = request.method.toUpperCase();
  if (method !== 'GET' && !(await isSameOrigin(request))) {
    return NextResponse.json({ error: 'So‘rov rad etildi' }, { status: 403 });
  }

  const contentType = request.headers.get('content-type') || '';
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};

  if (method !== 'GET') {
    if (IMAGE_TYPES.some((type) => contentType.startsWith(type))) {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'Rasm 5 MB dan katta bo‘lmasligi kerak' }, { status: 413 });
      }
      body = bytes;
      headers['Content-Type'] = contentType.split(';')[0];
    } else {
      // Read as text and hand it on verbatim; the backend's zod schemas are the authority on
      // shape, so nothing is re-serialised (and nothing is guessed at) here.
      const text = await request.text();
      if (text.length > 100_000) {
        return NextResponse.json({ error: 'So‘rov hajmi juda katta' }, { status: 413 });
      }
      body = text;
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const upstream = await backendFetch(path, { method, headers, body });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        // Nothing behind this door is cacheable — some of it is account credentials.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    if (error?.message === 'NO_SESSION') return unauthorized();
    return NextResponse.json({ error: 'Server bilan bog‘lanib bo‘lmadi' }, { status: 502 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await params).path);
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await params).path);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(request, (await params).path);
}
