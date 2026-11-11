import Link from 'next/link';
import { Header, Footer } from '@/components/Chrome';
import { Catalog } from '@/components/Catalog';
import { Icon } from '@/components/Icon';
import { getInitialCatalog } from '@/lib/server/catalog';
export default async function HomePage() {
  const initial = await getInitialCatalog();
  return <><Header /><main id="main-content">
    <section className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 sm:px-8 md:flex-row md:items-center md:justify-between md:py-12">
        <div className="max-w-xl">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">Keyingi akkauntingiz shu yerda.</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted">Akkaunt tanlang, to‘lang va tekshiring. Bitmax to‘lovni bitim yakunlanguncha saqlaydi.</p>
          <Link href="/shartlar" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-accent"><Icon name="shield" width={17} /> To‘lov va qaytarish shartlari</Link>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href="/kabinet/yangi" className="btn-accent"><Icon name="plus" width={18} /> Akkaunt sotish</Link>
          <Link href="/kod" className="btn-ghost"><Icon name="code" width={18} /> Bitim kodini kiritish</Link>
        </div>
      </div>
    </section>
    <Catalog initial={initial} />
  </main><Footer /></>;
}
