import mongoose from 'mongoose';
import { z } from 'zod';
import { config } from '../config';
import { Transaction, ITransaction } from '../models/Transaction';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { EscrowHold } from '../models/EscrowHold';
import { paymentService, PaymentAllocationError } from './paymentService';
import { notificationService } from './notificationService';
import { HamyonError, hamyonClient, verifyHamyonSignature } from './hamyonClient';

/** Callbacks are the source of truth; this only covers a callback that never arrives. */
export const HAMYON_EXPIRY_GRACE_SECONDS = 120;

class ReservationLost extends Error {}

/**
 * Creates the order's HamyonAPI payment.
 *
 * HamyonAPI matches transfers by amount and refuses a second open payment with the same amount
 * in one shop, so the requested amount is `price + offset` (offset 0, 1, 2, …). The product
 * price and every ledger figure stay `basePrice`; the extra so'm are shown to the buyer as the
 * exact amount to send. `uniqueAmount` (partial unique index over pending rows) is the local
 * guard against two open orders ever holding the same amount; the provider's own refusal is the
 * second guard.
 */
export async function openHamyonPayment(
  product: { _id: any; price: number; sellerId: any },
  buyerId: string,
): Promise<ITransaction> {
  let rejections = 0;
  for (let offset = 0; offset <= config.hamyon.maxAmountOffset; offset++) {
    const amount = product.price + offset;
    const id = new mongoose.Types.ObjectId();
    const expireAt = new Date(Date.now() + config.hamyon.windowSeconds * 1000);
    let tx: ITransaction;
    try {
      tx = await Transaction.create({
        _id: id, productId: product._id, buyerId, sellerId: product.sellerId,
        basePrice: product.price, expectedAmount: product.price, uniqueAmount: amount,
        paymentProvider: 'hamyon', hamyonOrderId: String(id), hamyonAmount: amount,
        status: 'pending_payment', expireAt,
      });
    } catch (err: any) {
      if (err?.code === 11000) continue; // another open order already holds this amount
      throw err;
    }
    try {
      const created = await hamyonClient.createPayment(String(id), amount);
      const providerExpiry = created.expire_at ? new Date(created.expire_at * 1000) : expireAt;
      const set = { hamyonPaymentId: created.payment_id, hamyonCard: created.card, expireAt: providerExpiry };
      try {
        await Transaction.updateOne({ _id: id, status: 'pending_payment' }, { $set: set });
      } catch (err: any) {
        // Cannot persist the provider's id. The callback can still adopt it through order_id.
        if (err?.code === 11000) throw new PaymentAllocationError();
        console.error('[Hamyon] Could not store payment id for order', String(id));
      }
      Object.assign(tx, set);
      await Product.updateOne(
        { _id: product._id, status: 'reserved', reservedBy: buyerId },
        { $set: { reservedUntil: new Date(providerExpiry.getTime() + HAMYON_EXPIRY_GRACE_SECONDS * 1000) } },
      );
      return tx;
    } catch (err) {
      // Whatever happened remotely, this local row is dead. A late "paid" for it is routed to an
      // operator instead of being lost (see processCallback).
      await Transaction.updateOne({ _id: id, status: 'pending_payment' },
        { $set: { status: 'cancelled', cancelReason: err instanceof HamyonError ? `hamyon_create_${err.kind}` : 'hamyon_create_failed' } });
      if (err instanceof HamyonError && err.kind === 'rejected' && ++rejections <= 5) continue; // most likely an amount collision
      if (err instanceof HamyonError) {
        console.error('[Hamyon] Payment creation failed:', err.kind);
        throw new PaymentAllocationError(err.kind === 'not_configured'
          ? 'To‘lov tizimi sozlanmagan — administrator bilan bog‘laning' : undefined);
      }
      throw err;
    }
  }
  throw new PaymentAllocationError();
}

// ───────────────────────────── callbacks ─────────────────────────────

const text = (max: number) => z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(max));
const callbackSchema = z.object({
  payment_id: text(100), order_id: text(100), shop_id: text(20), amount: text(20),
  status: text(20), sign: text(64),
  paid_at: z.union([z.string(), z.number()]).transform(String).optional(),
  reason: z.string().max(200).optional(),
}).passthrough();

export interface CallbackReply { code: number; body: string }
const ok = (body = 'ok'): CallbackReply => ({ code: 200, body });
const bad = (body: string, code = 400): CallbackReply => ({ code, body });

export async function processHamyonCallback(kind: 'prepare' | 'complete', raw: unknown): Promise<CallbackReply> {
  const parsed = callbackSchema.safeParse(raw);
  if (!parsed.success) return bad('invalid payload');
  const cb = parsed.data;
  // The signature covers the values exactly as received, so verify before touching anything.
  if (cb.shop_id !== config.hamyon.shopId || !verifyHamyonSignature(cb)) return bad('invalid signature');
  if (!/^\d{1,15}$/.test(cb.amount)) return bad('invalid amount');
  if (kind === 'prepare' ? cb.status !== 'prepare' : !['paid', 'cancel'].includes(cb.status)) return bad('invalid status');

  let tx = await Transaction.findOne({ hamyonPaymentId: cb.payment_id });
  if (!tx) {
    // The create response may not have been stored yet (crash / timeout): adopt the id the
    // signed callback proves belongs to this order.
    const byOrder = mongoose.isValidObjectId(cb.order_id) ? await Transaction.findOne({ hamyonOrderId: cb.order_id }) : null;
    if (!byOrder) return bad('unknown payment', 404);
    if (byOrder.hamyonPaymentId && byOrder.hamyonPaymentId !== cb.payment_id) return bad('payment mismatch');
    if (!byOrder.hamyonPaymentId) {
      try {
        await Transaction.updateOne({ _id: byOrder._id, hamyonPaymentId: { $exists: false } }, { $set: { hamyonPaymentId: cb.payment_id } });
      } catch { return bad('temporary error', 503); }
    }
    tx = await Transaction.findById(byOrder._id);
    if (!tx || tx.hamyonPaymentId !== cb.payment_id) return bad('payment mismatch');
  }
  if (tx.paymentProvider !== 'hamyon' || tx.hamyonOrderId !== cb.order_id) return bad('order mismatch');
  if (tx.hamyonAmount !== Number(cb.amount)) return bad('amount mismatch');

  if (kind === 'prepare') {
    // Records that the buyer started paying. Never fulfils anything.
    await Transaction.updateOne({ _id: tx._id, hamyonPreparedAt: { $exists: false } }, { $set: { hamyonPreparedAt: new Date() } });
    return ok();
  }
  return cb.status === 'paid' ? fulfilPaid(tx, cb.paid_at) : applyCancel(tx, cb.reason);
}

async function flagForReview(tx: ITransaction, reason: string, extra: Record<string, unknown> = {}) {
  const res = await Transaction.updateOne({ _id: tx._id, paymentReview: { $exists: false } }, { $set: { paymentReview: reason, ...extra } });
  if (res.modifiedCount) {
    // The buyer paid real money and would otherwise see nothing but an "expired" order.
    const buyer = await User.findById(tx.buyerId).select('telegramId');
    if (buyer?.telegramId) {
      await notificationService.send({
        type: 'buyer',
        chatId: buyer.telegramId,
        message:
          `💳 <b>To‘lovingiz qabul qilindi</b>\n\nBuyurtma muddati o‘tib ketgan bo‘lsa ham pulingiz yo‘qolmaydi: ` +
          `administrator uni qo‘lda tekshiradi va buyurtmani tiklaydi yoki pulni qaytaradi. Qayta to‘lamang.\n` +
          `Buyurtma: <code>${tx._id}</code>`,
      }).catch(() => undefined);
    }
    const sent = await notificationService.notifyAdmin(`⚠️ HamyonAPI: ${reason}. Buyurtma: ${tx._id}, summa: ${tx.hamyonAmount}. Qo‘lda tekshiring.`);
    if (sent) await Transaction.updateOne({ _id: tx._id }, { $set: { paymentReviewNotifiedAt: new Date() } });
  }
}

async function fulfilPaid(tx: ITransaction, paidAt?: string): Promise<CallbackReply> {
  if (tx.status === 'paid' || tx.status === 'completed' || tx.status === 'refunded') return ok('duplicate');
  if (tx.status !== 'pending_payment') {
    // Expired/cancelled locally but the provider says the money arrived: needs a human.
    await flagForReview(tx, `paid_after_${tx.status}`);
    return ok('review');
  }
  let lost = false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const claimed = await Transaction.findOneAndUpdate(
        { _id: tx._id, status: 'pending_payment', hamyonPaymentId: tx.hamyonPaymentId },
        { $set: { status: 'paid', paidAt: new Date(), ...(paidAt ? { hamyonPaidAt: paidAt } : {}) } },
        { new: true, session });
      if (!claimed) return; // already settled by a concurrent/duplicate callback
      const reserved = await Product.exists({ _id: tx.productId, status: 'reserved', reservedBy: tx.buyerId }).session(session);
      if (!reserved) throw new ReservationLost();
      await paymentService.fundEscrow(claimed, session, { provider: 'hamyon', paymentId: tx.hamyonPaymentId, amount: tx.hamyonAmount });
    });
  } catch (err) {
    if (err instanceof ReservationLost) lost = true;
    else return bad('temporary error', 500); // provider retries
  } finally { await session.endSession(); }

  if (lost) {
    await Transaction.updateOne({ _id: tx._id, status: 'pending_payment' }, { $set: { status: 'expired', cancelReason: 'hamyon_paid_reservation_lost' } });
    await flagForReview(tx, 'paid_but_reservation_lost');
    return ok('review');
  }
  await notifyHamyonPaid(tx._id);
  return ok();
}

async function applyCancel(tx: ITransaction, reason?: string): Promise<CallbackReply> {
  // A cancel can never undo a payment, and a stale one is simply acknowledged.
  const expired = await Transaction.findOneAndUpdate({ _id: tx._id, status: 'pending_payment' },
    { $set: { status: 'expired', cancelReason: 'hamyon_cancel', ...(reason ? { hamyonCancelReason: reason } : {}) } });
  if (!expired) return ok('duplicate');
  const released = await paymentService.releaseReservation(String(tx.productId), undefined, String(tx.buyerId));
  if (released) await paymentService.notifySellerDealReopened(String(tx.productId)).catch(() => undefined);
  const [buyer, product] = await Promise.all([User.findById(tx.buyerId).select('telegramId'), Product.findById(tx.productId).select('title listingType dealCode')]);
  if (buyer?.telegramId && product) await notificationService.notifyPaymentWindowExpired(buyer.telegramId, product.title || 'Mahsulot', String(product._id), product.listingType === 'private' ? product.dealCode : undefined);
  return ok();
}

export async function notifyHamyonPaid(transactionId: unknown) {
  const t = await Transaction.findOne({ _id: transactionId, status: 'paid', paymentNotifiedAt: { $exists: false } });
  if (!t) return;
  const [buyer, product, hold] = await Promise.all([
    User.findById(t.buyerId).select('telegramId'), Product.findById(t.productId).select('title'), EscrowHold.findOne({ transactionId: t._id }),
  ]);
  if (buyer?.telegramId && hold) {
    const sent = await notificationService.notifyPaymentConfirmed(buyer.telegramId, product?.title || 'Mahsulot', t.basePrice, String(hold._id), hold.autoReleaseAt);
    if (sent) await Transaction.updateOne({ _id: t._id }, { $set: { paymentNotifiedAt: new Date() } });
    // The seller learns of the sale the moment it is paid, not at reveal or release time.
    await paymentService.notifySellerPaid(String(hold._id)).catch(() => undefined);
  }
}

/** Scheduler backstop: re-sends confirmations that failed inline. No provider polling. */
export async function sweepHamyonNotifications() {
  const paid = await Transaction.find({ paymentProvider: 'hamyon', status: 'paid', paymentNotifiedAt: { $exists: false } }).limit(30);
  for (const t of paid) await notifyHamyonPaid(t._id).catch(() => undefined);

  // Money that arrived but needs a human. If the first admin alert failed (Telegram down), later
  // duplicate callbacks stay silent, so without this retry nobody would ever hear about it.
  const unreported = await Transaction.find({
    paymentProvider: 'hamyon',
    paymentReview: { $exists: true },
    paymentReviewNotifiedAt: { $exists: false },
  }).limit(20);
  for (const t of unreported) {
    const sent = await notificationService
      .notifyAdmin(`⚠️ HamyonAPI: ${t.paymentReview}. Buyurtma: ${t._id}, summa: ${t.hamyonAmount}. Qo‘lda tekshiring.`)
      .catch(() => false);
    if (sent) await Transaction.updateOne({ _id: t._id }, { $set: { paymentReviewNotifiedAt: new Date() } });
  }
}
