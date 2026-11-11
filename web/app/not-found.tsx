import type { Metadata } from 'next';
import Link from 'next/link';
import { Header, Footer } from '@/components/Chrome';

export const metadata: Metadata = { title: 'Sahifa topilmadi' };

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main-content" className="mx-auto flex max-w-lg flex-col items-center px-5 py-20 text-center sm:px-8">
        <p className="font-display text-5xl font-extrabold text-faint">404</p>
        <h1 className="mt-4 text-2xl font-bold text-ink">Bunday sahifa yo‘q</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Havola eskirgan bo‘lishi mumkin — mahsulot sotilgan yoki e’lon olib tashlangan.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          <Link href="/katalog" className="btn-accent">
            Katalogga qaytish
          </Link>
          <Link href="/kabinet" className="btn-ghost">
            Kabinet
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
