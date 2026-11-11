import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/products/categories`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      next: { revalidate: 60 },
    });

    const data = await res.json();
    return NextResponse.json(data, res.ok
      ? { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
      : { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
