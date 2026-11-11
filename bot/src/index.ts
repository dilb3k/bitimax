// MUST be first: tells the shared config this process is the bot, so it does not demand (or
// hold) the API-only secrets such as the website session key.
process.env.SERVICE_ROLE = 'bot';

import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config, connectDatabase } from './core';
import { createBot, launchWithRetry, markStopping } from './bot';

/**
 * Bitimax Telegram bot service.
 *
 * Production: Telegram pushes updates to POST /telegram/webhook (authenticated with a secret
 * token only Telegram and this service know). Local dev: long polling when no public URL is set.
 */
async function main() {
  await connectDatabase();

  const bot = await createBot();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());

  // Liveness for the platform + a cheap way to wake a sleeping free instance.
  app.get(['/health', '/healthz'], (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', service: 'bitimax-bot' });
  });

  if (bot && config.botWebhookUrl) {
    // Derived from the bot token, so it is unguessable without already owning the bot,
    // and no extra secret has to be kept in sync across services.
    const secret = crypto.createHmac('sha256', config.botToken).update('telegram-webhook-v2').digest('hex');
    bot.botInfo = await bot.telegram.getMe();
    const path = new URL(config.botWebhookUrl).pathname;
    app.post(path, express.json({ limit: '1mb' }), bot.webhookCallback(path, { secretToken: secret }));
    await bot.telegram.setWebhook(config.botWebhookUrl, {
      secret_token: secret,
      max_connections: 10,
      allowed_updates: ['message', 'callback_query'],
    });
    console.log('[Bot] Telegram webhook registered');
  } else if (bot) {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    void launchWithRetry(bot);
  }

  app.use((_req, res) => void res.status(404).json({ error: 'Not found' }));

  const server = app.listen(config.port, () => console.log(`[Bot] listening on ${config.port}`));

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      markStopping();
      bot?.stop(signal);
      server.close(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('[Bot] Fatal startup error:', err);
  process.exit(1);
});
