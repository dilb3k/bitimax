import { NextRequest, NextResponse } from 'next/server';

import { publicBackendFetch } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = new URLSearchParams(searchParams);

    // Sent with the visitor's identity (not a shared cache) so the API rate-limits each visitor
    // separately; otherwise one client varying the query could exhaust the limit for everyone.
    const res = await publicBackendFetch(`/api/products?${params}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    // Public catalog data: let Vercel's CDN serve it for a few seconds so visitors do not each
    // pay the round trip to the API (and the API's rate limiter only sees cache misses).
    return NextResponse.json(data, res.ok ? { status: res.status, headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } } : { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
