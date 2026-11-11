import Link from 'next/link';
import { Product, TRUST_LABEL, formatUzs } from '@/lib/api';
import { Icon } from './Icon';
import { SafeImage } from './SafeImage';

export function ProductCard({ product }: { product: Product }) {
  const seller = product.seller;
  const thumbnail = product.images?.[0];
  const placeholder = <div className="flex h-full flex-col items-center justify-center gap-3 text-muted"><Icon name="grid" width={30} height={30} /><span className="text-sm font-medium">{product.category}</span></div>;
  return <article className="surface group overflow-hidden transition-colors hover:border-accent/60">
    <Link href={`/product/${product._id}`} className="flex h-full flex-col focus-visible:outline-offset-[-3px]" aria-label={`${product.title}, ${formatUzs(product.price)}`}>
      <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-raised">
        {thumbnail ? <SafeImage src={thumbnail} alt={product.title} width={400} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover" fallback={placeholder} /> : placeholder}
        <span className="absolute bottom-3 left-3 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium">{product.category}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-faint"><span>{product.listingCode ? `ID ${product.listingCode}` : 'Akkaunt'}</span><span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" /> Sotuvda</span></div>
        <h3 className="line-clamp-2 text-base font-semibold leading-6 group-hover:text-accent">{product.title}</h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{product.description}</p>
        <p className="tnum mt-auto pt-4 text-xl font-bold">{formatUzs(product.price)}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
          <span>{seller ? TRUST_LABEL[seller.trustLevel] : 'Sotuvchi'}</span>
          {seller?.rating != null ? <span className="inline-flex items-center gap-1"><Icon name="star" width={14} height={14} /><span className="sr-only">Baho:</span>{seller.rating.toFixed(1)} / 5</span> : <span>Batafsil →</span>}
        </div>
      </div>
    </Link>
  </article>;
}

export function ProductCardSkeleton() {
  return <div className="surface overflow-hidden" aria-hidden="true"><div className="skeleton aspect-[16/10]" /><div className="space-y-3 p-4"><div className="skeleton h-3 w-20" /><div className="skeleton h-5 w-4/5" /><div className="skeleton h-4 w-full" /><div className="skeleton h-6 w-28" /><div className="skeleton h-4 w-2/3" /></div></div>;
}
