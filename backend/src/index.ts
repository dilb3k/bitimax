import { hamyonWebhook } from './routes/hamyonWebhook';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { connectDatabase } from './db/mongoose';
import { Telegram } from 'telegraf';
import { notificationService } from './services/notificationService';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import smsWebhookRoutes from './routes/smsWebhook';
import productRoutes from './routes/products';
import transactionRoutes from './routes/transactions';
import escrowRoutes from './routes/escrow';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import { healthRoutes } from './routes/health';
import { identifyWebProxy, requireWebProxy, clientIp } from './middleware/webProxy';
import { rejectOperatorInjection } from './middleware/sanitize';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key'],
  })
);
app.use(hamyonWebhook); // Own body parsers (urlencoded + JSON) and rate limit.
app.use(express.json({ limit: '100kb' }));
app.use(rejectOperatorInjection);
app.use(identifyWebProxy);

app.use(healthRoutes);

// Generous global limiter as a DoS backstop; individual routes tighten this further.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
});
app.use(globalLimiter);

// The SMS-forwarder webhook can mark orders as paid, so it only exists while SMS is the
// payment provider. With HamyonAPI the signed provider callback is the single way to pay.
if (config.paymentProvider === 'sms') app.use('/api', smsWebhookRoutes);
app.use('/api/auth', requireWebProxy, authRoutes);
app.use('/api/me', requireWebProxy, meRoutes);
app.use('/api/products', productRoutes);
// Operator tooling (refund / release by raw escrow id). Not used by the site or the bot.
if (config.enableInternalApi) {
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/escrow', escrowRoutes);
}

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler: never leak internal error details (stack traces, driver
// error messages, file paths) to the client — log server-side, respond generically.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err);
  res.status(err?.status || 500).json({
    error: config.isProd ? 'Internal server error' : err?.message || 'Internal server error',
  });
});

async function start() {
  await connectDatabase();

  app.listen(config.port, () => {
    console.log(`[Server] Bitmax API running on port ${config.port}`);
    if (config.paymentProvider === 'sms') console.log(`[Server] SMS Webhook: POST /api/sms-webhook`);
    console.log(`[Server] Products API: GET /api/products`);
    console.log(`[Server] Web auth: POST /api/auth/start · GET /api/auth/poll`);
    console.log(`[Server] Web cabinet: /api/me/* (session token)`);
    if (config.enableInternalApi) console.log(`[Server] Internal API enabled: /api/transactions, /api/escrow`);
  });

  // The Telegram bot is a separate service (see /bot). The API only *sends* messages
  // (payment confirmations, alerts) through a stateless client — it never receives updates.
  if (config.botToken) {
    notificationService.setTelegram(new Telegram(config.botToken));
  } else if (config.isProd) {
    throw new Error('[Server] BOT_TOKEN is required to deliver notifications');
  } else {
    console.warn('[Server] BOT_TOKEN not set — Telegram notifications are skipped.');
  }

  // Payment expiry, escrow auto-settlement, reconciliation. Set JOBS_ENABLED=false on any
  // extra replica so only one instance sweeps.
  startScheduler();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => stopScheduler());
  }
}

process.on('unhandledRejection', (reason) => console.error('[Server] Unhandled rejection:', reason));
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  process.exit(1);
});

start().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});

export default app;
