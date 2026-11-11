import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/products/${encodeURIComponent((await params).id)}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      next: { revalidate: 30 },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch product' },
      { status: 500 }
    );
  }
}
