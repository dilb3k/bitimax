'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { botLink } from '@/lib/api';
import { Logo, LogoMark } from './Logo';
import { MobileNav } from './MobileNav';

/**
 * Reads the display-only companion cookie the login flow writes alongside the session.
 *
 * The session itself is httpOnly and unreadable here on purpose. This cookie holds a name and
 * a role and decides exactly one thing — whether the header says "Kirish" or "Kabinet". Every
 * real permission decision is made by the backend against the signed token, so nothing breaks
 * (and nothing is granted) if a user edits it.
 */
export function useSessionDisplay() {
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  // Re-read on every navigation: signing in and signing out are client-side transitions, and
  // a header stuck on "Kirish" after a successful login reads as a failed login.
  const pathname = usePathname();

  useEffect(() => {
    try {
      const match = document.cookie.split('; ').find((row) => row.startsWith('bx_user='));
      // Clearing on absence matters as much as setting on presence — after a logout the
      // cookie is gone and the header has to fall back to the signed-out state.
      setUser(match ? JSON.parse(decodeURIComponent(match.slice('bx_user='.length))) : null);
    } catch {
      // A malformed cookie just means the header shows the signed-out state.
    }
  }, [pathname]);

  return user;
}

export function Header() {
  const user = useSessionDisplay();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">Asosiy qismga o‘tish</a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo priority />

        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/katalog" className="hidden px-3 py-2 text-sm text-muted hover:text-ink sm:block">
            Katalog
          </Link>
          <Link href="/kod" className="hidden px-3 py-2 text-sm text-muted hover:text-ink sm:block">
            Bitim kodi
          </Link>
          <Link href="/kabinet/yangi" className="hidden items-center gap-1 px-3 py-2 text-sm font-semibold text-accent lg:flex">+ E’lon berish</Link>
          <ThemeToggle />
          <Link href={user ? '/kabinet' : '/kirish'} className="btn-accent px-3.5 py-2 text-sm">
            {user ? 'Kabinet' : 'Kirish'}
          </Link>
          <MobileNav authed={Boolean(user)} />
        </nav>
      </div>
    </header>
  );
}

function ThemeToggle() {
  // Starts null so the button renders nothing theme-specific until the client has read the
  // stored preference — otherwise the server-rendered icon can contradict the applied theme.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('bitmax-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode — the choice just won't persist */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Yorug‘ rejimga o‘tish' : 'Qorong‘i rejimga o‘tish'}
      className="rounded-lg border border-line min-h-[44px] min-w-[44px] p-2 text-muted transition hover:bg-raised hover:text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        ) : (
          <path
            d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

export function Footer() {
  return <footer className="mt-8 shrink-0 border-t border-line bg-surface">
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-7 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
      <div className="flex items-center gap-3"><LogoMark size={22} /><span className="font-semibold">Bitmax</span><span className="text-faint">© {new Date().getFullYear()}</span></div>
      <nav aria-label="Qo‘shimcha havolalar" className="flex flex-wrap gap-x-6 gap-y-3 text-muted">
        <Link href="/shartlar" className="inline-block py-2.5 hover:text-ink">Savdo shartlari</Link>
        <a href={botLink()} target="_blank" rel="noopener noreferrer" className="inline-block py-2.5 hover:text-ink">Telegram bot</a>
        <a href="https://t.me/bitimax_admin" target="_blank" rel="noopener noreferrer" className="inline-block py-2.5 hover:text-ink">Yordam</a>
      </nav>
    </div>
  </footer>;
}
