import { Request, Response, NextFunction } from 'express';
import { config, safeEquals } from '../config';
import net from 'net';

/**
 * The website's server (Next.js route handlers) is the only legitimate client of the
 * authenticated API: browsers never talk to this service directly. Requiring a shared key on
 * those routes shrinks the exposed surface to "someone who already owns the site's secret",
 * and lets us trust the visitor IP the site forwards.
 */
function hasValidKey(req: Request): boolean {
  const provided = req.header('x-web-key') || '';
  return Boolean(config.webProxyKey) && provided.length > 0 && safeEquals(provided, config.webProxyKey);
}

/** Marks requests that came through the site and records the visitor's real IP. */
export function identifyWebProxy(req: Request, _res: Response, next: NextFunction) {
  if (hasValidKey(req)) {
    const forwarded = (req.header('x-client-ip') || '').trim();
    if (forwarded && net.isIP(forwarded)) (req as any).clientIp = forwarded;
  }
  next();
}

/** Blocks everything that did not come through the site (no-op until WEB_PROXY_KEY is set). */
export function requireWebProxy(req: Request, res: Response, next: NextFunction) {
  if (config.webProxyKey && !hasValidKey(req)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

/** Visitor IP for rate limiting / audit: the forwarded one when trusted, else the socket's. */
export function clientIp(req: Request): string {
  return String((req as any).clientIp || req.ip || '');
}
