import type { Metadata } from 'next';
import { OrderView } from '@/components/cabinet/OrderView';

export const metadata: Metadata = { title: 'Buyurtma', robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderView key={id} orderId={id} />;
}
