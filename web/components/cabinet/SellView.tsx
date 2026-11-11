'use client';

import { Icon } from "@/components/Icon";
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/cabinet';
import { formatUzs, timeAgo } from '@/lib/api';
import { Badge, CopyButton, EmptyState, ErrorState, Loading, Notice, SubmitButton, useAsync } from '../ui';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Qoralama',
  pending_review: 'Tekshirilmoqda',
  rejected: 'Rad etilgan',
  active: 'Faol',
  reserved: 'Band qilingan',
  sold: 'Sotilgan',
  refunded: 'Qaytarilgan',
  disputed: 'Nizoda',
  archived: 'Arxiv',
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'accent' | 'muted'> = {
  active: 'ok',
  pending_review: 'accent',
  reserved: 'accent',
  rejected: 'warn',
  disputed: 'warn',
  sold: 'muted',
};

export function SellView() {
  const [tab, setTab] = useState<'listings' | 'sales'>('listings');
  const listings = useAsync(() => api.listings());
  const sales = useAsync(() => api.sales());
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.cancelListing(id);
      setCancelId(null);
      await listings.reload();
    } catch (err: any) {
      setError(err?.message || 'Bekor qilib bo‘lmadi');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div><p className="eyebrow">SOTUVCHI MAYDONI</p><h1 className="page-title mt-2">Sotuvlarim</h1><p className="mt-2 text-sm text-muted">E’lon joylang, shaxsiy bitim yarating va natijani kuzating.</p></div>
      <div className="flex flex-wrap gap-2.5">
        <Link href="/kabinet/yangi" className="btn-accent text-sm">
          <Icon name="plus" /> Yangi e’lon
        </Link>
        <Link href="/kabinet/bitim" className="btn-ghost text-sm">
          <Icon name="shield" /> Kod bilan bitim
        </Link>
      </div>

      {error && <Notice tone="warn">{error}</Notice>}

      <div className="flex gap-2 border-b border-line pb-3" aria-label="Sotuv bo‘limlari">
        <button type="button" className={`chip ${tab === 'listings' ? 'chip-on' : ''}`} aria-pressed={tab === 'listings'} onClick={() => setTab('listings')}>E’lonlarim</button>
        <button type="button" className={`chip ${tab === 'sales' ? 'chip-on' : ''}`} aria-pressed={tab === 'sales'} onClick={() => setTab('sales')}>Sotilganlar</button>
      </div>
      <section hidden={tab !== 'listings'}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-faint">E’lonlarim</h2>

        {listings.loading && <Loading />}
        {listings.error && <ErrorState message={listings.error} onRetry={listings.reload} />}

        {!listings.loading && !listings.error && (listings.data?.listings.length ?? 0) === 0 && (
          <EmptyState
            title="Hali e’lon yo‘q"
            hint="Katalogga akkaunt qo‘ying yoki kelishilgan xaridor uchun kafil bitim yarating."
          />
        )}

        <ul className="space-y-3">
          {listings.data?.listings.map((listing) => (
            <li key={listing.id} className="surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{listing.title}</p>
                  <p className="tnum mt-0.5 text-sm text-muted">{formatUzs(listing.price)}</p>
                  <p className="mt-1 text-xs text-faint">
                    {listing.listingType === 'private' ? 'Kod bilan bitim' : listing.category} ·{' '}
                    {timeAgo(listing.createdAt)}
                    {listing.listingType === 'public' && ` · ${listing.viewCount} ko‘rish`}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[listing.status] || 'muted'}>
                  {STATUS_LABEL[listing.status] || listing.status}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                {listing.listingCode && <><span className="font-mono text-sm text-muted">ID {listing.listingCode}</span><CopyButton value={listing.listingCode} label="ID’ni nusxalash" /></>}
                {['active', 'pending_review', 'draft', 'rejected'].includes(listing.status) && <button type="button" onClick={() => setCancelId(listing.id)} className="ml-auto min-h-[44px] text-sm text-warn" disabled={busyId !== null}>Bekor qilish</button>}
              </div>
              {cancelId === listing.id && <div className="mt-3 rounded-lg border border-line bg-raised p-4">
                <p className="text-sm">E’lon katalogdan olib tashlanadi. Bekor qilasizmi?</p>
                <div className="mt-3 flex gap-2"><SubmitButton busy={busyId === listing.id} disabled={busyId !== null} onClick={() => cancel(listing.id)}>Ha, bekor qilish</SubmitButton><button type="button" disabled={busyId !== null} onClick={() => setCancelId(null)} className="btn-ghost">Ortga</button></div>
              </div>}

              {listing.moderationNote && (
                <p className="mt-3 rounded-lg bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
                  Moderator izohi: {listing.moderationNote}
                </p>
              )}

              {listing.dealCode && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3.5 py-3">
                  <div>
                    <p className="text-xs text-faint">Bitim kodi</p>
                    <p className="tnum font-mono text-lg font-bold tracking-wider text-ink">
                      {listing.dealCode}
                    </p>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <CopyButton value={listing.dealCode} name="bitim kodi" />

                  </div>
                </div>
              )}

              {listing.status === 'active' && listing.listingType === 'public' && (
                <Link
                  href={`/product/${listing.id}`}
                  className="mt-3 inline-flex text-sm text-accent hover:underline"
                >
                  Katalogda ko‘rish →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section hidden={tab !== 'sales'}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-faint">Sotuvlarim</h2>

        {sales.loading && <Loading />}
        {sales.error && <ErrorState message={sales.error} onRetry={sales.reload} />}

        {!sales.loading && !sales.error && (sales.data?.sales.length ?? 0) === 0 && (
          <EmptyState title="Hali sotuv yo‘q" hint="Birinchi bitim yakunlangach shu yerda ko‘rinadi." />
        )}

        <ul className="space-y-3">
          {sales.data?.sales.map((sale) => (
            <li key={sale.id} className="surface flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{sale.title}</p>
                <p className="mt-0.5 text-xs text-faint">
                  {timeAgo(sale.boughtAt)}
                  {sale.rating ? ` · Baho: ${sale.rating}/5` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tnum font-semibold text-ink">{formatUzs(sale.sellerPayout)}</p>
                <div className="mt-1">
                  <Badge tone={sale.status === 'released' ? 'ok' : sale.status === 'holding' ? 'accent' : 'muted'}>
                    {sale.statusLabel}
                  </Badge>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
