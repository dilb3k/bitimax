import { NextRequest, NextResponse } from 'next/server';

/**
 * Per-request Content-Security-Policy with a fresh nonce.
 *
 * A nonce is what makes `script-src` strict enough to be worth having. Next's App Router
 * streams its hydration payload through inline `<script>` tags, so the only alternatives are
 * `'unsafe-inline'` — which is to say, no XSS protection at all — or handing each request a
 * one-time nonce that Next stamps onto its own scripts and an injected string can never guess.
 *
 * On a site where a signed-in seller's page can display account credentials, script injection
 * is the whole ballgame: `connect-src 'self'` plus `form-action 'self'` mean that even if
 * markup were somehow injected, it has nowhere to send what it reads.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    `default-src 'self'`,
    // 'strict-dynamic' lets the nonced Next bootstrap load its own chunks without listing
    // every hashed filename. Dev additionally needs eval for React Refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    // Tailwind ships as a stylesheet, but next/font and Next's dev overlay both emit inline
    // style attributes. Inline *style* cannot exfiltrate data the way inline script can.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://res.cloudinary.com`,
    `font-src 'self'`,
    // Same-origin only: every backend call goes through this app's own route handlers.
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    isDev ? '' : 'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search);
  // Next reads the nonce back out of this request header to stamp its own script tags.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimizer output, which carry no markup.
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',

    },
  ],
};
