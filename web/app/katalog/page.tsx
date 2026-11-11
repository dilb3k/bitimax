import type { Metadata } from 'next';
import { Header, Footer } from '@/components/Chrome';
import { Catalog } from '@/components/Catalog';
import { getInitialCatalog } from '@/lib/server/catalog';
export const metadata: Metadata = { title: 'Akkauntlar katalogi' };
export default async function CatalogPage() {
  const initial = await getInitialCatalog();
  return <><Header /><main id="main-content" className="min-h-[70vh]"><Catalog standalone initial={initial} /></main><Footer /></>;
}
