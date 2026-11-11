import { NextRequest, NextResponse } from 'next/server';

import { publicBackendFetch } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const res = await publicBackendFetch(`/api/products/${encodeURIComponent((await params).id)}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    return NextResponse.json(data, res.ok ? { status: res.status, headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60' } } : { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    );
  }
}
