import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Manrope } from 'next/font/google';
import './globals.css';

// next/font downloads and self-hosts these at build time, so there is no runtime request to
// a font CDN — no third-party connection, no flash of fallback text.
const body = Manrope({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://web-three-eosin-46.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: 'Bitmax — Kafil bilan xavfsiz raqamli bozor',
    template: '%s · Bitmax',
  },
  description:
    'Raqamli savdo, himoyalangan to‘lov va kafil bitimlar bir joyda. Bitmax — P2P escrow (kafil) ' +
    'tizimida ishlaydigan raqamli akkauntlar bozori.',
  keywords: ['escrow', 'kafil', 'garant', 'akkaunt sotish', 'Telegram akkaunt', 'Bitmax'],
  openGraph: {
    title: 'Bitmax — Kafil bilan xavfsiz raqamli bozor',
    description: 'Raqamli savdo, himoyalangan to‘lov va kafil bitimlar bir joyda.',
    type: 'website',
    locale: 'uz_UZ',
    siteName: 'Bitmax',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

/**
 * Applies the stored theme before first paint. Without this the page renders in the default
 * theme for a frame and then snaps — the classic dark-mode flash.
 */
const noFlashTheme = `
(function(){try{
  var t = localStorage.getItem('bitmax-theme');
  var dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Middleware mints one nonce per request; the page's only inline script carries it, so
  // `script-src` can stay strict instead of falling back to 'unsafe-inline'.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="uz" className={body.variable} suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning: the browser strips `nonce` off the DOM node once it has
          used it (a deliberate anti-exfiltration measure), so React's client-side pass reads
          an empty attribute and reports a mismatch on a tag that is in fact correct.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: noFlashTheme }}
        />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
