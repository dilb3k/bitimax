import { Icon } from "@/components/Icon";
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Header, Footer } from '@/components/Chrome';
import { ProductGallery } from '@/components/ProductGallery';
import { Product, TRUST_LABEL, botLink, formatUzs, timeAgo } from '@/lib/api';

const TRUST_STYLE: Record<string, string> = {
  new: 'text-faint',
  verified: 'text-ok',
  trusted: 'text-ok',
  partner: 'text-accent',
};

// Fetched directly from the backend rather than through the `/api/products/[id]` proxy route —
// this is itself a server component, so there's no browser round trip to keep BACKEND_URL
// hidden from; going straight there saves a hop. The proxy route stays in place for any
// client-side code that still wants it.
async function getProduct(id: string): Promise<Product | null> {
  const backend = process.env.BACKEND_URL;
  if (!backend) return null;
  const res = await fetch(`${backend}/api/products/${encodeURIComponent(id)}`, {
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error('Mahsulotni yuklab bo‘lmadi');
  return (await res.json()).product ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const product = await getProduct((await params).id);
  if (!product) return { title: 'Mahsulot topilmadi' };
  return {
    title: product.title, // the layout template appends " · Bitmax"
    description: product.description.slice(0, 160),
  };
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const product = await getProduct((await params).id);
  if (!product) notFound();

  const seller = product.seller;

  return (
    <>
      <Header />
      <main id="main-content">
        <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
          <Link href="/katalog" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
            ← Katalogga qaytish
          </Link>

          <div className="grid gap-8 sm:grid-cols-2">
            <ProductGallery images={product.images ?? []} title={product.title} />

            <div className="flex flex-col">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="rounded-md bg-raised px-2 py-1 text-xs font-medium text-muted">
                  {product.category}
                </span>
                <time className="text-xs text-faint" dateTime={product.createdAt}>
                  {timeAgo(product.createdAt)}
                </time>
              </div>

              <h1 className="text-2xl font-bold leading-snug text-ink sm:text-3xl">{product.title}</h1>
              {product.listingCode && <p className="mt-2 font-mono text-sm text-faint">E’lon ID: {product.listingCode}</p>}

              {seller && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className={`font-medium ${TRUST_STYLE[seller.trustLevel] ?? 'text-faint'}`}>
                    {TRUST_LABEL[seller.trustLevel]}
                  </span>
                  {seller.rating !== null && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="tnum text-muted">
                        <span className="sr-only">Sotuvchi bahosi: </span><Icon name="star" width={14} height={14} className="mr-1 inline-block align-text-bottom" />{seller.rating.toFixed(1)} <span className="text-faint">({seller.ratingCount})</span>
                      </span>
                    </>
                  )}
                  {seller.sold > 0 && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="tnum text-faint">{seller.sold} ta sotgan</span>
                    </>
                  )}
                </div>
              )}

              <p className="tnum mt-6 text-3xl font-bold text-ink">{formatUzs(product.price)}</p>

              <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                {product.status === 'active' ? <Link href={`/sotib-olish/${product._id}`} className="btn-accent sm:px-6">Sotib olish</Link> : <span className="btn-ghost text-muted">{product.status === 'sold' ? 'Sotilgan' : 'Hozir band'}</span>}
                <a
                  href={botLink(product._id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost"
                >
                  Botda ochish
                </a>
              </div>

              <div className="surface mt-6 p-4 text-sm leading-relaxed text-muted">
                Pul kafilda saqlanadi. Tekshirish va avtomatik yakunlash muddati buyurtmada ko‘rsatiladi.
                Login/parol to‘lov tasdiqlangandan keyin, faqat sizga ochiladi.
              </div>

              <div className="mt-8 border-t border-line pt-6">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-faint">
                  Tavsif
                </h2>
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
                  {product.description}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
