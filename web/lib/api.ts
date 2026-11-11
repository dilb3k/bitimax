export interface Seller {
  username?: string;
  trustLevel: 'new' | 'verified' | 'trusted' | 'partner';
  sold: number;
  rating: number | null;
  ratingCount: number;
}

export interface Product {
  _id: string;
  listingCode?: string;
  status: 'active' | 'reserved' | 'sold'; 
  title: string;
  description: string;
  price: number;
  category: string;
  tags?: string[];
  /** Cloudinary URLs, up to 8 — empty for anything listed before image upload shipped. */
  images?: string[];
  viewCount?: number;
  createdAt: string;
  seller: Seller | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface PublicPolicy {
  commission: number;
  paymentProvider: 'sms' | 'hamyon';
  paymentWindowMinutes: number;
  autoReleaseHours: number;
  unrevealedGraceHours: number;
  refundTiers: { id: string; label: string; penaltyPercent: number; allowed: boolean }[];
}

export interface PlatformStats {
  active: number;
  sold: number;
  sellers: number;
  commission: number;
}

export interface ProductQuery {
  page?: number;
  category?: string;
  search?: string;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
}

/** Formats so'm the way local price tags do — thin-spaced groups, no decimals. */
export function formatUzs(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US').replace(/,/g, ' ')} so‘m`;
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/**
 * Date parts in Tashkent time. The 'uz-UZ' locale is not shipped by every browser and falls back
 * to raw tokens like "M11", so month names are spelled out here instead of trusting Intl data.
 */
function tashkentParts(iso: string | number | Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** "11-noyabr, 18:21" */
export function formatDateTime(iso: string | number | Date): string {
  const p = tashkentParts(iso);
  return `${p.day}-${MONTHS[p.month - 1]}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** "11.11.2026" */
export function formatDate(iso: string | number | Date): string {
  const p = tashkentParts(iso);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'hozir';
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} kun oldin`;
  return formatDate(iso);
}

export const TRUST_LABEL: Record<Seller['trustLevel'], string> = {
  new: 'Yangi sotuvchi',
  verified: 'Tasdiqlangan',
  trusted: 'Ishonchli',
  partner: 'Hamkor',
};

function buildQuery(query: ProductQuery): string {
  const params = new URLSearchParams({ page: String(query.page ?? 1), limit: '24' });
  if (query.category) params.set('category', query.category);
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.minPrice) params.set('minPrice', String(query.minPrice));
  if (query.maxPrice) params.set('maxPrice', String(query.maxPrice));
  return params.toString();
}

/**
 * All reads go through the Next route handlers rather than straight to the backend, so the
 * backend's address stays server-side and the browser only ever talks to this origin.
 */
export async function fetchProducts(
  query: ProductQuery,
  signal?: AbortSignal
): Promise<{ products: Product[]; pagination: Pagination }> {
  const res = await fetch(`/api/products?${buildQuery(query)}`, { signal });
  if (!res.ok) throw new Error('Mahsulotlarni yuklab bo‘lmadi');
  const data = await res.json();
  return {
    products: data.products ?? [],
    pagination: data.pagination ?? { page: 1, limit: 24, total: 0, pages: 0 },
  };
}

/** Single product for the detail page — goes through the existing `/api/products/[id]` proxy. */
export async function fetchProduct(id: string): Promise<Product | null> {
  try {
    const res = await fetch(`/api/products/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.product ?? null;
  } catch {
    return null;
  }
}

export async function fetchCategories(): Promise<CategoryCount[]> {
  const res = await fetch('/api/products/categories');
  if (!res.ok) return [];
  const data = await res.json();
  if (Array.isArray(data.counts)) return data.counts;
  // Older backend shape returned bare names.
  return (data.categories ?? []).map((category: string) => ({ category, count: 0 }));
}

export async function fetchStats(): Promise<PlatformStats | null> {
  try {
    const res = await fetch('/api/products/stats');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function botLink(productId?: string): string {
  const username = process.env.NEXT_PUBLIC_BOT_USERNAME || 'bitimax_bot';
  return productId ? `https://t.me/${username}?start=buy_${productId}` : `https://t.me/${username}`;
}
