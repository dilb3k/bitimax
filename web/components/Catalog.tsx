'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CategoryCount,
  Pagination,
  Product,
  fetchCategories,
  fetchProducts,
} from '@/lib/api';
import type { InitialCatalog } from '@/lib/server/catalog';
import { ProductCard, ProductCardSkeleton } from './ProductCard';

const SORTS = [
  { value: '-createdAt', label: 'Yangilari' },
  { value: 'price', label: 'Arzonidan' },
  { value: '-price', label: 'Qimmatidan' },
];

export function Catalog({ standalone = false, initial = null }: { standalone?: boolean; initial?: InitialCatalog | null }) {
  const Heading = standalone ? 'h1' : 'h2';
  const [products, setProducts] = useState<Product[]>(initial?.products ?? []);
  const [pagination, setPagination] = useState<Pagination>(
    initial?.pagination ?? { page: 1, limit: 24, total: 0, pages: 0 }
  );
  const [categories, setCategories] = useState<CategoryCount[]>(initial?.categories ?? []);
  // The server already rendered the default first page; skip the redundant first fetches.
  const skipInitialLoad = useRef(Boolean(initial));
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('-createdAt');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [minPriceInput, setMinPriceInput] = useState('');
  const [maxPriceInput, setMaxPriceInput] = useState('');
  const [minPrice, setMinPrice] = useState<number | undefined>(undefined);
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    fetchCategories().then(setCategories).catch(() => setCategories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce the search box. The previous version fired a request on every keystroke, which
  // meant a five-letter query cost five round trips and the answers could arrive out of order.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Same debounce treatment as search — typing a price shouldn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      const min = parseInt(minPriceInput.replace(/\D/g, ''), 10);
      const max = parseInt(maxPriceInput.replace(/\D/g, ''), 10);
      setMinPrice(Number.isFinite(min) && min > 0 ? min : undefined);
      setMaxPrice(Number.isFinite(max) && max > 0 ? max : undefined);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [minPriceInput, maxPriceInput]);

  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // Abort the in-flight request so a slow earlier response can't overwrite a newer one.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchProducts(
        { page, category, search, sort, minPrice, maxPrice },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setProducts(data.products);
      setPagination(data.pagination);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError('Mahsulotlarni yuklab bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [page, category, search, sort, minPrice, maxPrice]);

  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  function pickCategory(value: string) {
    setCategory(value);
    setPage(1);
  }

  return (
    <section id="katalog" className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Heading className="text-2xl font-bold text-ink">Akkauntlar katalogi</Heading>
          <p className="mt-1.5 text-sm text-muted">
            {loading && products.length === 0 ? (
              'Yuklanmoqda…'
            ) : (
              <>
                <span className="tnum font-medium text-ink">{pagination.total}</span> ta e’lon
                {category && ` · ${category}`}
              </>
            )}
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={sort === option.value}
              onClick={() => {
                setSort(option.value);
                setPage(1);
              }}
              className={`min-h-[44px] rounded-md px-3 py-1.5 text-sm transition ${
                sort === option.value
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="sr-only" htmlFor="qidiruv">
          Qidirish
        </label>
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            id="qidiruv"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Akkaunt nomi yoki e’lon ID’si"
            className="field min-h-[48px] pl-10"
          />
        </div>
      </div>

      <details className="mb-4 border-b border-line pb-4">
        <summary className="cursor-pointer text-sm font-medium">Narx bo‘yicha saralash</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted" htmlFor="min-narx">
          Narx:
        </label>
        <input
          id="min-narx"
          type="text"
          inputMode="numeric"
          value={minPriceInput}
          onChange={(event) => setMinPriceInput(event.target.value)}
          placeholder="Eng kam"
          className="field w-28 py-2 text-sm"
        />
        <span className="text-faint">—</span>
        <input
          aria-label="Maksimal narx"
          type="text"
          inputMode="numeric"
          value={maxPriceInput}
          onChange={(event) => setMaxPriceInput(event.target.value)}
          placeholder="Eng ko‘p"
          className="field w-28 py-2 text-sm"
        />
        <span className="text-sm text-faint">so‘m</span>
      </div>

      </details>
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => pickCategory('')}
          aria-pressed={category === ''}
          className={`chip ${category === '' ? 'chip-on' : ''}`}
        >
          Barchasi
        </button>
        {categories.map((item) => (
          <button
            key={item.category}
            type="button"
            onClick={() => pickCategory(item.category)}
            aria-pressed={category === item.category}
            className={`chip ${category === item.category ? 'chip-on' : ''}`}
          >
            {item.category}
            {item.count > 0 && <span className="tnum text-faint">{item.count}</span>}
          </button>
        ))}
      </div>

      {(searchInput || category || minPriceInput || maxPriceInput) && <button type="button" className="btn-ghost mb-5 text-sm" onClick={() => { setSearchInput(''); setCategory(''); setMinPriceInput(''); setMaxPriceInput(''); setPage(1); }}>Filtrlarni tozalash</button>}
      {minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice && <p role="status" className="mb-4 text-sm text-warn">Eng kam narx eng ko‘p narxdan katta bo‘lmasin.</p>}
      {error ? (
        <div className="surface p-10 text-center">
          <p className="text-ink">{error}</p>
          <button type="button" onClick={load} className="btn-ghost mt-4">
            Qayta urinish
          </button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Two cards on phones, one row (2 / 3) on wider screens. A taller placeholder than the loaded
              list made the footer jump up by hundreds of pixels the moment products arrived. */}
          {[0, 1, 2].map((i) => (
            <div key={i} className={i === 2 ? 'hidden lg:block' : undefined}>
              <ProductCardSkeleton />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          hasFilters={Boolean(search || category || minPrice || maxPrice)}
          onReset={() => {
            setSearchInput('');
            setCategory('');
            setMinPriceInput('');
            setMaxPriceInput('');
            setPage(1);
          }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product._id} product={product} />
            ))}
          </div>
          <Pager pagination={pagination} onChange={setPage} />
        </>
      )}
    </section>
  );
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="surface px-6 py-16 text-center">
      <p className="font-display text-lg font-semibold text-ink">
        {hasFilters ? 'Bu so‘rov bo‘yicha hech narsa topilmadi' : 'Katalog hozircha bo‘sh'}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        {hasFilters
          ? 'Boshqa kalit so‘z bilan qidiring yoki kategoriyani o‘zgartiring.'
          : 'Raqamli mahsulotingizni soting yoki tayyor kelishuv uchun kafil bitim yarating.'}
      </p>
      {!hasFilters && <Link href="/kabinet/yangi" className="btn-accent mt-5">Birinchi e’lonni berish</Link>}
      {hasFilters && (
        <button type="button" onClick={onReset} className="btn-ghost mt-5">
          Filtrlarni tozalash
        </button>
      )}
    </div>
  );
}

function Pager({
  pagination,
  onChange,
}: {
  pagination: Pagination;
  onChange: (page: number) => void;
}) {
  if (pagination.pages <= 1) return null;

  const { page, pages } = pagination;
  // Show the first, last, and a window around the current page; everything else collapses.
  const visible = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - page) <= 1
  );

  function go(next: number) {
    onChange(next);
    document.getElementById('katalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className="mt-10 flex items-center justify-center gap-1.5" aria-label="Sahifalash">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="btn-ghost px-3 py-2 text-sm"
      >
        ← Oldingi
      </button>

      {visible.map((n, index) => (
        <span key={n} className="flex items-center">
          {index > 0 && visible[index - 1] !== n - 1 && (
            <span className="px-1.5 text-faint">…</span>
          )}
          <button
            type="button"
            onClick={() => go(n)}
            aria-current={n === page ? 'page' : undefined}
            className={`tnum h-10 w-10 rounded-lg text-sm font-medium transition ${
              n === page
                ? 'bg-accent text-[rgb(var(--accent-ink))]'
                : 'border border-line bg-surface text-muted hover:text-ink'
            }`}
          >
            {n}
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= pages}
        className="btn-ghost px-3 py-2 text-sm"
      >
        Keyingi →
      </button>
    </nav>
  );
}
