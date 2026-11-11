import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from '@/lib/server/session';
import { Header, Footer } from '@/components/Chrome';
import { StartPurchase } from '@/components/StartPurchase';

export const metadata: Metadata = {
  title: 'Sotib olish',
  robots: { index: false, follow: false },
};

export default async function StartPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Same routing rule as the cabinet: do not show a buy form (and its "reserved for 10 minutes"
  // promise) to someone who is about to be sent to the login screen anyway.
  if (!(await cookies()).get(SESSION_COOKIE)?.value) redirect(`/kirish?next=${encodeURIComponent(`/sotib-olish/${id}`)}`);
  return (
    <>
      <Header />
      <main id="main-content" className="mx-auto max-w-lg px-5 py-10 sm:px-8 sm:py-14">
        <StartPurchase key={id} productId={id} />
      </main>
      <Footer />
    </>
  );
}
