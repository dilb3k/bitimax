import express, { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { processHamyonCallback } from '../services/hamyonPayments';

/**
 * Public callbacks called by HamyonAPI (configure both URLs in its dashboard):
 *   prepare_url  = https://<DOMAIN>/api/payments/hamyon/prepare
 *   complete_url = https://<DOMAIN>/api/payments/hamyon/complete
 * The docs' sample receives urlencoded bodies; JSON is accepted too. Authenticity comes only
 * from the md5 `sign`, never from the caller's address.
 */
export const hamyonWebhook = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
const parsers = [express.urlencoded({ extended: false, limit: '10kb' }), express.json({ limit: '10kb' })];

for (const kind of ['prepare', 'complete'] as const) {
  hamyonWebhook.post(`/api/payments/hamyon/${kind}`, limiter, ...parsers, async (req: Request, res: Response) => {
    try {
      const reply = await processHamyonCallback(kind, req.body);
      res.status(reply.code).type('text/plain').send(reply.body);
    } catch {
      // Never leak internals; a non-2xx makes the provider retry.
      res.status(500).type('text/plain').send('error');
    }
  });
}
