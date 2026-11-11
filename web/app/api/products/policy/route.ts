import { NextResponse } from 'next/server';
import { getPolicy } from '@/lib/server/policy';
export async function GET() {
 const policy = await getPolicy();
 return policy ? NextResponse.json(policy, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }) : NextResponse.json({ error: 'Shartlarni yuklab bo‘lmadi' }, { status: 503 });
}
