import { Telegraf, Scenes, session } from 'telegraf';
import { config, CATEGORIES } from './core';
import { mongoSessionStore } from './core';
import { User } from './core';
import { notificationService } from './core';
import { startHandler, createPayoutWizards, keyboardFor } from './handlers/start';
import { sellerHandler, createSellerWizard, createDealWizard } from './handlers/seller';
import { buyerHandler, createCodeWizard } from './handlers/buyer';
import { adminHandler, createRoleWizard } from './handlers/admin';
import { marketplace } from './core';
import { listingLookup } from './handlers/catalog';
import { escapeHtml, formatUzs } from './core';

/** Builds the fully wired Telegraf instance. Launching (webhook vs polling) is index.ts's job. */
export async function createBot(): Promise<Telegraf<any> | null> {
  if (!config.botToken || config.botToken === 'YOUR_BOT_TOKEN_HERE') {
    // In production the bot *is* the product: refuse to boot half a platform. Locally, a
    // missing token is the normal case while working on the website, so the API and the
    // scheduler are allowed to run without it instead of taking the whole process down.
    if (config.isProd) {
      throw new Error('[Bot] BOT_TOKEN is not configured! Please set BOT_TOKEN in .env file');
    }
    console.warn(
      '[Bot] BOT_TOKEN not set — bot disabled. The API and the scheduler keep running; ' +
        'Telegram notifications are skipped.'
    );
    return null;
  }

  const bot = new Telegraf<any>(config.botToken);
  notificationService.setTelegram(bot.telegram);

  const stage = new Scenes.Stage<any>([
    createSellerWizard(),
    createDealWizard(),
    createCodeWizard(),
    createRoleWizard(),
    ...createPayoutWizards(),
  ]);

  // Persisted in Mongo rather than Telegraf's default in-memory Map, so a deploy no longer
  // wipes every half-finished listing wizard and multiple replicas can share state.
  bot.command(['healt', 'health'], async (ctx) => {
    await ctx.reply('Bitmax bot ishlayapti.');
  });

  bot.use(session({ store: mongoSessionStore }));

  /**
   * Registers the user and stops blocked accounts at the door. `isBlocked` existed in v1 but
   * was never read anywhere — blocking a scammer flipped a boolean and changed nothing.
   */
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    try {
      const user = await marketplace.getOrCreateUser(ctx.from.id, ctx);
      if (user.isBlocked) {
        const notice = `❌ Hisobingiz bloklangan.\n${user.blockReason || ''}\n\n${marketplace.supportLink()}`;
        if (ctx.callbackQuery) await ctx.answerCbQuery('Hisobingiz bloklangan');
        else await ctx.reply(notice);
        return;
      }
      (ctx.state as any).user = user;
    } catch (err) {
      console.error('[Bot] Failed to resolve user:', err);
      await ctx.reply('Hisobni yuklab bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.');
      return;
    }

    return next();
  });

  bot.use(listingLookup);
  bot.use(stage.middleware());

  bot.use(startHandler);
  bot.use(sellerHandler);
  bot.use(buyerHandler);
  bot.use(adminHandler);

  bot.action('settings_notifications', async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from!.id });
    if (!user) return void ctx.answerCbQuery('Topilmadi');

    user.notificationSettings.newOrder = !user.notificationSettings.newOrder;
    await user.save();

    await ctx.answerCbQuery(user.notificationSettings.newOrder ? 'Yoqildi' : 'O‘chirildi');
    await ctx.replyWithHTML(
      `✅ Bildirishnomalar yangilandi:\n` +
        `• Yangi buyurtma: ${user.notificationSettings.newOrder ? '✅' : '❌'}\n` +
        `• To‘lov: ${user.notificationSettings.paymentConfirm ? '✅' : '❌'}\n` +
        `• Qaytarish: ${user.notificationSettings.refundUpdate ? '✅' : '❌'}`
    );
  });

  bot.action('back_main', async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from!.id });
    await ctx.reply('Asosiy menu', keyboardFor(user?.role || 'buyer'));
    await ctx.answerCbQuery();
  });

  bot.command('categories', async (ctx) => {
    await ctx.replyWithHTML('<b>📂 Kategoriyalar</b>', {
      reply_markup: {
        inline_keyboard: CATEGORIES.map((c) => [{ text: c, callback_data: `cat_${c}` }]),
      },
    });
  });

  bot.action(/^cat_(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    const { products, total } = await marketplace.getActiveProducts(1, 10, category);

    if (products.length === 0) {
      await ctx.editMessageText(`📂 <b>${escapeHtml(category)}</b> — mahsulot topilmadi`, {
        parse_mode: 'HTML',
      });
      await ctx.answerCbQuery();
      return;
    }

    const lines = products.map(
      (p) => `• <b>${escapeHtml(p.title)}</b> — ${formatUzs(p.price)}\n  /p_${p._id}`
    );

    await ctx.editMessageText(
      [`<b>📂 ${escapeHtml(category)}</b> (${total} ta)`, '', ...lines].join('\n'),
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery();
  });

  /** `/p_<id>` opens a listing — the link format the category browser emits. */
  bot.hears(/^\/p_([0-9a-fA-F]{24})$/, async (ctx) => {
    const productId = ctx.match[1];
    await ctx.replyWithHTML('Mahsulotni ochish:', {
      reply_markup: {
        inline_keyboard: [[{ text: '🔍 Batafsil', callback_data: `detail_${productId}` }]],
      },
    });
  });

  bot.catch((err: any, ctx: any) => {
    console.error(`[Bot] Error handling ${ctx?.updateType}:`, err);
  });

  return bot;
}

/** Signals the polling supervisor that shutdown is intentional. */
export function markStopping() {
  stopping = true;
}

let stopping = false;

/**
 * Keeps the bot polling across transient Telegram failures.
 *
 * The one that matters is 409 Conflict. Render (like most platforms) does a zero-downtime
 * rollout: the new instance boots while the old one is still draining, so for a few seconds
 * two processes poll the same token and Telegram rejects one of them. Telegraf treats that as
 * fatal and stops the polling loop for good — which meant every single deploy left the bot
 * silently dead until someone noticed and restarted it by hand.
 *
 * Retrying with backoff rides out the overlap: the loser waits, the old instance finishes
 * shutting down, and the next attempt succeeds.
 */
export async function launchWithRetry(bot: Telegraf<any>): Promise<void> {
  const MAX_ATTEMPTS = 20;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !stopping; attempt++) {
    try {
      if (attempt === 1) console.log('[Bot] Bitmax bot starting (long polling)…');
      // Resolves only once the bot is stopped, so reaching the next line means a clean stop.
      await bot.launch({ dropPendingUpdates: true });
      console.log('[Bot] Polling loop ended cleanly');
      return;
    } catch (err: any) {
      if (stopping) return;

      const code = err?.response?.error_code ?? err?.code;
      const isConflict = code === 409;

      if (!isConflict && attempt >= 5) {
        console.error('[Bot] Giving up after repeated non-conflict failures:', err?.message || err);
        return;
      }

      // Cap the wait at 30s: a deploy overlap clears in well under a minute, and a longer
      // backoff would just extend the window where the bot answers nobody.
      //
      // The jitter is what actually breaks the deadlock. Both instances run this same loop,
      // so a purely deterministic backoff has them wake in lockstep and collide again and
      // again — observed in production as four straight rounds of mutual 409s. Randomising
      // the wait means one of them reaches Telegram alone on the next attempt.
      const base = Math.min(30_000, 3_000 * 2 ** Math.min(attempt - 1, 4));
      const waitMs = Math.round(base * (0.5 + Math.random()));
      console.warn(
        `[Bot] Polling failed (${isConflict ? '409 conflict — another instance is still polling' : code || 'unknown'}). ` +
          `Retry ${attempt}/${MAX_ATTEMPTS} in ${Math.round(waitMs / 1000)}s`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  if (!stopping) {
    console.error('[Bot] Could not start polling after all retries — bot is NOT running');
  }
}
