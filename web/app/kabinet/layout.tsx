import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Header, Footer } from '@/components/Chrome';
import { CabinetNav } from '@/components/cabinet/CabinetNav';
import { safeNextPath } from '@/lib/navigation';
import { SESSION_COOKIE } from '@/lib/server/session';

/**
 * Keeps signed-out visitors off the cabinet shell so they get the login screen instead of a
 * page full of failed requests.
 *
 * This is a routing convenience, not the access control: the cookie is only checked for
 * presence here. Whether it is a real, unexpired session for a user who is still allowed to
 * trade is decided by the backend on every single request behind `/api/me`.
 */
export default async function CabinetLayout({ children }: { children: React.ReactNode }) {
  if (!(await cookies()).get(SESSION_COOKIE)?.value) redirect(`/kirish?next=${encodeURIComponent(safeNextPath((await headers()).get('x-pathname')))}`);

  return (
    <>
      <Header />
      <main id="main-content" className="mx-auto grid min-h-[70vh] max-w-6xl gap-8 px-5 py-8 pb-24 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-10">
        <CabinetNav />
        <div className="min-w-0">{children}</div>
      </main>
      {/* Clears the fixed bottom tab bar on phones, which otherwise covers the footer links. */}
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <Footer />
      </div>
    </>
  );
}
