import 'server-only';
import type { CategoryCount, Pagination, Product } from '../api';

export interface InitialCatalog {
  products: Product[];
  pagination: Pagination;
  categories: CategoryCount[];
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function get(path: string): Promise<any | null> {
  try {
    // Shared data cache (30s): the first catalog page is the same for every visitor, so it is
    // fetched once per window instead of once per page view.
    const res = await fetch(`${BACKEND_URL}${path}`, { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * First page of the public catalog, rendered into the HTML. Without it the page shows skeletons,
 * waits for the JavaScript bundle, then makes a second round trip before anything appears.
 * Returns null on any failure — the client then loads the catalog itself, as before.
 */
export async function getInitialCatalog(): Promise<InitialCatalog | null> {
  const [list, cats] = await Promise.all([
    get('/api/products?page=1&limit=24&sort=-createdAt'),
    get('/api/products/categories'),
  ]);
  if (!list?.products) return null;
  return {
    products: list.products,
    pagination: list.pagination ?? { page: 1, limit: 24, total: list.products.length, pages: 1 },
    categories: Array.isArray(cats?.counts) ? cats.counts : [],
  };
}
