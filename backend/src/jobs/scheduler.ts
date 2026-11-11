import { sweepHamyonNotifications, HAMYON_EXPIRY_GRACE_SECONDS } from '../services/hamyonPayments';
import { Transaction } from '../models/Transaction';
import { EscrowHold } from '../models/EscrowHold';
import { Product } from '../models/Product';
import { PaymentInbox } from '../models/PaymentInbox';
import { paymentService, AlreadyProcessedError } from '../services/paymentService';
import { ledgerService } from '../services/ledgerService';
import { notificationService } from '../services/notificationService';
import { config } from '../config';
import { formatUzs, formatDateTime, escapeHtml } from '../utils/helpers';

/**
 * The platform's clock.
 *
 * Two of the TZ's headline rules were pure prose before this existed: "the payment window is
 * 10 minutes" and "after 24 hours the money goes to the seller". Nothing expired anything and
 * nothing released anything — an escrow the buyer never touched sat in `holding` forever, and
 * a seller was never paid unless the buyer remembered to press a button.
 */

type Job = { name: string; intervalMs: number; run: () => Promise<void> };

const timers: NodeJS.Timeout[] = [];

/**
 * Expires payment windows that have lapsed and puts the listing back on sale.
 *
 * The transaction row is *kept* (previously a TTL index deleted it), because a bank transfer
 * that lands a minute late must still be traceable to the order it was meant for.
 */
export async function expirePendingTransactions(): Promise<number> {
  const now = new Date();
  const stale = await Transaction.find({ status: 'pending_payment', $or: [
    { paymentProvider: { $ne: 'hamyon' }, expireAt: { $lt: now } },
    // HamyonAPI sends `cancel` itself; this only backstops a callback that never arrived.
    { paymentProvider: 'hamyon', expireAt: { $lt: new Date(now.getTime() - HAMYON_EXPIRY_GRACE_SECONDS * 1000) } },
  ] })
    .limit(500)
    .select('_id productId buyerId')
    .populate('buyerId', 'telegramId')
    .populate('productId', 'title listingType dealCode');

  let expired = 0;
  for (const transaction of stale) {
   try {
    const claimed = await Transaction.findOneAndUpdate(
      { _id: transaction._id, status: 'pending_payment' },
      { $set: { status: 'expired', cancelReason: 'payment_window_lapsed' } }
    );
    if (!claimed) continue;

    // `productId` is populated below (for the notification's title), so it's a document here,
    // not a bare ObjectId — release must be pointed at its `_id`, not stringified directly.
    const buyer = transaction.buyerId as any;
    const product = transaction.productId as any;

    const productId = String(product?._id || transaction.productId);
    const released = await paymentService.releaseReservation(productId, undefined, String(buyer?._id || transaction.buyerId));
    expired += 1;
    // A private deal's seller is waiting on this buyer: say that the code is live again.
    if (released) await paymentService.notifySellerDealReopened(productId).catch(() => undefined);

    // Previously silent — a buyer who missed the window had no way to learn the reservation
    // lapsed short of reopening the listing and noticing it was gone.
    if (buyer?.telegramId && product) {
      await notificationService.notifyPaymentWindowExpired(
        buyer.telegramId,
        product.title || 'Mahsulot',
        String(product._id),
        product.listingType === 'private' ? product.dealCode : undefined
      );
    }
   } catch (err) {
    // One bad row must not stop the rest; the orphan sweeper below frees any stuck reservation.
    console.error(`[Jobs] Failed to expire transaction ${transaction._id}:`, err);
   }
  }

  if (expired > 0) console.log(`[Jobs] Expired ${expired} pending transaction(s)`);
  return expired;
}

/**
 * Frees products stuck in `reserved`: a crash between reserving a listing and creating its
 * transaction, or a failed release after expiry, would otherwise hide the listing forever
 * (a product can only be reserved from `active`). Only reservations past their deadline with no
 * live payment attached are touched.
 */
export async function releaseOrphanedReservations(): Promise<number> {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  const stuck = await Product.find({ status: 'reserved', reservedUntil: { $lt: cutoff } }).select('_id').limit(200);
  let freed = 0;
  for (const product of stuck) {
    const live = await Transaction.exists({ productId: product._id, status: { $in: ['pending_payment', 'paid'] } });
    if (live) continue;
    if (await paymentService.releaseReservation(String(product._id))) freed += 1;
  }
  if (freed > 0) console.log(`[Jobs] Released ${freed} orphaned reservation(s)`);
  return freed;
}

/**
 * Settles escrows whose deadline passed.
 *
 * Two different deadlines meet here. A buyer who opened the credentials and then went quiet
 * has accepted the goods, so the money goes to the seller. A buyer who never even opened them
 * received nothing, so releasing to the seller would be paying for an undelivered order —
 * that one is refunded in full and the listing returns to the catalog.
 */
export async function settleDueEscrows(): Promise<{ released: number; refunded: number }> {
  const due = await EscrowHold.find({ status: 'holding', autoReleaseAt: { $lt: new Date() } })
    .limit(200)
    .populate('buyerId', 'telegramId')
    .populate('sellerId', 'telegramId')
    .populate('productId', 'title');

  let released = 0;
  let refunded = 0;

  for (const hold of due) {
    const product = hold.productId as any;
    const buyer = hold.buyerId as any;
    const seller = hold.sellerId as any;

    try {
      if (hold.credentialsRevealedAt) {
        await paymentService.releaseToSeller(String(hold._id));
        released += 1;

        await notificationService.notifySeller(
          seller?.telegramId,
          `✅ <b>Bitim yakunlandi</b>\n\n` +
            `Mahsulot: ${escapeHtml(product?.title || '—')}\n` +
            `Sizga o‘tkazildi: <b>${formatUzs(hold.sellerPayout)}</b>\n` +
            `Komissiya: ${formatUzs(hold.commission)}\n\n` +
            `<i>${config.autoReleaseHours} soat ichida e’tiroz bildirilmadi.</i>`
        );
        await notificationService.notifyBuyer(
          buyer?.telegramId,
          `ℹ️ <b>Buyurtma yopildi</b>\n\n${escapeHtml(product?.title || '—')} bo‘yicha ` +
            `${config.autoReleaseHours} soatlik muddat tugadi va pul sotuvchiga o‘tkazildi.`
        );
      } else {
        await paymentService.processRefund(
          String(hold._id),
          `Xaridor ${config.unrevealedGraceHours} soat ichida ma’lumotlarni ochmadi — avtomatik qaytarish`,
          undefined,
          { onlyIfUnrevealed: true }
        );
        const relisted = await Product.findByIdAndUpdate(hold.productId, {
          $set: { status: 'active' },
          $unset: { buyerId: '', soldAt: '' },
        }, { new: true });
        if (relisted?.listingType === 'private') {
          // Same rule as a lapsed payment: do not let the deal's old deadline kill it right away.
          const keepOpenUntil = new Date(Date.now() + 24 * 3600_000);
          // Same 30-day ceiling as releaseReservation.
          await Product.updateOne(
            { _id: relisted._id, dealExpiresAt: { $lt: keepOpenUntil }, createdAt: { $gt: new Date(Date.now() - 30 * 24 * 3600_000) } },
            { $set: { dealExpiresAt: keepOpenUntil } }
          );
        }
        refunded += 1;
        await notificationService.notifySeller(
          seller?.telegramId,
          `🔄 <b>Xaridor ma’lumotlarni ochmadi</b>\n\n<b>${escapeHtml(product?.title || '—')}</b>\n` +
            `${config.unrevealedGraceHours} soat ichida ochilmagani uchun pul xaridorga qaytarildi, ` +
            `e’lon yana sotuvda${relisted?.listingType === 'private' ? ' (bitim kodi ishlaydi)' : ''}.`
        );

        await notificationService.notifyBuyer(
          buyer?.telegramId,
          `🔄 <b>Avtomatik qaytarish</b>\n\n` +
            `Siz ${config.unrevealedGraceHours} soat ichida akkaunt ma’lumotlarini ochmadingiz. ` +
            `${formatUzs(hold.amount)} balansingizga to‘liq qaytarildi.`
        );
      }
    } catch (err) {
      // Someone (the buyer, a refund) settled or revealed it between our read and the claim.
      if (err instanceof AlreadyProcessedError) continue;
      console.error(`[Jobs] Failed to settle escrow ${hold._id}:`, err);
    }
  }

  if (released || refunded) {
    console.log(`[Jobs] Settled escrows — released: ${released}, auto-refunded: ${refunded}`);
  }
  return { released, refunded };
}

/**
 * Wipes account credentials once an order is long settled. Holding a seller's live login
 * forever creates risk with no upside; after the retention window the dispute record is what
 * matters, not the password.
 */
export async function purgeExpiredCredentials(): Promise<number> {
  const cutoff = new Date(Date.now() - config.credentialRetentionDays * 24 * 3600_000);

  const result = await Product.updateMany(
    {
      status: { $in: ['sold', 'refunded', 'archived'] },
      // Listings that were never sold (archived/cancelled) have no soldAt; age them by updatedAt.
      $or: [{ soldAt: { $lt: cutoff } }, { soldAt: { $exists: false }, updatedAt: { $lt: cutoff } }],
      credentialsPurgedAt: { $exists: false },
    },
    {
      $set: {
        'sensitiveData.login': '',
        'sensitiveData.password': '',
        'sensitiveData.recoveryCode': '',
        'sensitiveData.additionalInfo': '',
        credentialsPurgedAt: new Date(),
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.log(`[Jobs] Purged credentials for ${result.modifiedCount} settled product(s)`);
  }
  return result.modifiedCount;
}

/**
 * Retires private deal codes nobody redeemed.
 *
 * An unclaimed code is a live credential sitting in the database waiting for whoever ends up
 * holding the message it was sent in. If the handover didn't happen within the window, the
 * safe assumption is that it isn't going to.
 */
export async function expireUnclaimedDeals(): Promise<number> {
  const stale = await Product.find({
    listingType: 'private',
    status: 'active',
    dealExpiresAt: { $lt: new Date() },
  })
    .limit(200)
    .select('_id title dealCode sellerId')
    .populate('sellerId', 'telegramId');

  let expiredCount = 0;
  for (const deal of stale) {
    const claimed = await Product.findOneAndUpdate(
      { _id: deal._id, status: 'active' },
      // The code is kept on purpose: it no longer works while the deal is archived, but the seller
      // can still see it and reopen the deal instead of losing it for good.
      { $set: { status: 'archived', archiveReason: 'expired' } }
    );
    if (!claimed) continue;
    expiredCount += 1;

    // Previously silent — the seller only found out via the buyer reporting "code doesn't
    // work" or by happening to reopen "📋 E’lonlarim" and noticing the code was gone.
    const seller = deal.sellerId as any;
    if (seller?.telegramId && deal.dealCode) {
      await notificationService.notifyDealExpired(seller.telegramId, deal.title, deal.dealCode);
    }
  }

  if (expiredCount > 0) console.log(`[Jobs] Expired ${expiredCount} unclaimed deal code(s)`);
  return expiredCount;
}

/**
 * Compares cached user balances against the ledger and shouts if they disagree. Silent drift
 * means some write path is moving money outside the journal, which is the one failure a
 * payments system must never discover from a customer complaint.
 */
export async function reconcileBalances(): Promise<number> {
  const drift = await ledgerService.findBalanceDrift();
  if (drift.length === 0) return 0;

  console.error('[Jobs] BALANCE DRIFT DETECTED:', drift);
  const summary = drift
    .slice(0, 10)
    .map((d) => `• ${d.userId}: kesh ${d.cached} vs ledger ${d.ledger}`)
    .join('\n');

  await notificationService.notifyAdmin(
    `🚨 <b>Balans nomuvofiqligi aniqlandi (${drift.length} ta)</b>\n\n${summary}\n\n` +
      `<i>Ledger — haqiqiy manba. Darhol tekshiring.</i>`
  );
  return drift.length;
}

/** Nags an operator about bank transfers that arrived but could not be attributed. */
export async function alertUnmatchedPayments(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000);
  const pending = await PaymentInbox.find({
    status: 'unmatched',
    reminderMuted: { $ne: true },
    receivedAt: { $lt: cutoff },
  }).limit(20);

  if (pending.length === 0) return 0;

  const lines = pending
    .map((p, index) => `${index + 1}. ${p.parsedAmount ? formatUzs(p.parsedAmount) : '—'} — ${formatDateTime(p.receivedAt)}`)
    .join('\n');

  await notificationService.notifyAdmin(
    `⚠️ <b>Egasi topilmagan to‘lovlar (${pending.length} ta)</b>\n\n${lines}\n\n` +
      `<i>Bu pullar bankka tushgan, lekin hech qaysi buyurtmaga bog‘lanmagan.</i>`,
    pending.map((p, index) => [{
      text: `🔕 ${index + 1}. ${p.parsedAmount ? formatUzs(p.parsedAmount) : 'To‘lov'} — eslatmani to‘xtatish`,
      callback_data: `inbox_mute_${p._id}`,
    }])
  );
  return pending.length;
}

const JOBS: Job[] = [
  { name: 'hamyonNotifications', intervalMs: 60_000, run: sweepHamyonNotifications },
  { name: 'expirePendingTransactions', intervalMs: 60_000, run: async () => void (await expirePendingTransactions()) },
  { name: 'releaseOrphanedReservations', intervalMs: 5 * 60_000, run: async () => void (await releaseOrphanedReservations()) },
  { name: 'settleDueEscrows', intervalMs: 5 * 60_000, run: async () => void (await settleDueEscrows()) },
  { name: 'alertUnmatchedPayments', intervalMs: 15 * 60_000, run: async () => void (await alertUnmatchedPayments()) },
  { name: 'reconcileBalances', intervalMs: 60 * 60_000, run: async () => void (await reconcileBalances()) },
  { name: 'purgeExpiredCredentials', intervalMs: 6 * 60 * 60_000, run: async () => void (await purgeExpiredCredentials()) },
  { name: 'expireUnclaimedDeals', intervalMs: 30 * 60_000, run: async () => void (await expireUnclaimedDeals()) },
];

export function startScheduler(): void {
  if (!config.jobsEnabled) {
    console.log('[Jobs] Scheduler disabled on this instance (JOBS_ENABLED=false)');
    return;
  }

  for (const job of JOBS) {
    const tick = async () => {
      try {
        await job.run();
      } catch (err) {
        // A failing job must never take the process down — it retries on the next tick.
        console.error(`[Jobs] ${job.name} failed:`, err);
      }
    };
    // Stagger the first run so a restart doesn't fire every job at once.
    const timer = setInterval(tick, job.intervalMs);
    timer.unref?.();
    timers.push(timer);
    // Also run once shortly after boot: on a host that sleeps or restarts often the long
    // intervals (hourly reconcile, 6-hourly purge) would otherwise never get a turn.
    const first = setTimeout(tick, 30_000);
    first.unref?.();
    timers.push(first as unknown as ReturnType<typeof setInterval>);
  }

  console.log(`[Jobs] Scheduler started with ${JOBS.length} jobs`);
}

export function stopScheduler(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
