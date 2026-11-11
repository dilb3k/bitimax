import express, { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { Transaction } from '../models/Transaction';
import { EscrowHold } from '../models/EscrowHold';
import { Payout } from '../models/Payout';
import { requireSession, AuthedRequest } from '../middleware/webAuth';
import { validateObjectId } from '../middleware/validateObjectId';
import { publicUser } from './auth';
import { marketplace } from '../services/marketplaceService';
import {
  paymentService,
  AlreadyProcessedError,
  ProductUnavailableError,
  PaymentAllocationError,
  ForbiddenError,
} from '../services/paymentService';
import { payoutService, InsufficientBalanceError } from '../services/payoutService';
import { ledgerService } from '../services/ledgerService';
import { describeRefundPolicy } from '../services/refundEngine';
import { notificationService } from '../services/notificationService';
import { uploadImageBuffer, ImageUploadError } from '../services/cloudinaryService';
import { CATEGORIES } from '../config';
import { clientIp } from '../middleware/webProxy';
import { config } from '../config';
import { escapeHtml, formatUzs, formatDealCode, maskCard } from '../utils/helpers';

/**
 * Everything a signed-in user can do from the website — the same operations the bot exposes,
 * against the same services.
 *
 * The rule this file follows: the web never gets its own copy of a money rule. Buying,
 * revealing, refunding, releasing and withdrawing all call into paymentService / payoutService
 * exactly as the bot handlers do, so a policy change lands in both surfaces at once and the
 * two can never drift into disagreeing about what a refund pays out.
 */
const router = Router();

router.use(requireSession);

/** Authenticated limits are per account, not per IP: the site's servers share a few egress IPs. */
const perUser = (req: Request) => String((req as AuthedRequest).authUser?._id || clientIp(req));

// ── Rate limits ────────────────────────────────────────────────────────────────
// Tight where an attempt is worth something to an attacker (guessing deal codes, opening
// credentials), loose where the operation is just reading your own data.
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser });
const codeLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser });
const revealLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser });
const uploadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: perUser });

function actor(req: Request) {
  return (req as AuthedRequest).authUser;
}

/** Turns a thrown service error into the right status code without leaking internals. */
function fail(res: Response, error: any, fallback = 'Xatolik yuz berdi') {
  if (error instanceof AlreadyProcessedError) return res.status(409).json({ error: error.message });
  if (error instanceof ProductUnavailableError) return res.status(409).json({ error: 'Mahsulot band yoki sotilgan' });
  if (error instanceof PaymentAllocationError) return res.status(503).json({ error: error.message });
  if (error instanceof ForbiddenError) return res.status(403).json({ error: 'Ruxsat yo‘q' });
  if (error instanceof InsufficientBalanceError) return res.status(400).json({ error: 'Balansda yetarli mablag‘ yo‘q' });
  if (error instanceof ImageUploadError) return res.status(400).json({ error: error.message });
  console.error('[Me] request failed:', error);
  return res.status(500).json({ error: config.isProd ? fallback : error?.message || fallback });
}

/** zod → 400 with a readable message, never a 500 and never the raw issue tree. */
function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const err: any = new Error(issue?.message || 'Ma’lumot noto‘g‘ri');
    err.status = 400;
    throw err;
  }
  return result.data;
}

function badRequest(res: Response, error: any) {
  if (error?.status === 400) return res.status(400).json({ error: error.message });
  return null;
}

// ── Profile ────────────────────────────────────────────────────────────────────

// Both paths serve the same document: `/api/me` is the natural REST shape, `/api/me/profile`
// is what the website's catch-all proxy route can address.
router.get(['/', '/profile'], async (req: Request, res: Response) => {
  const user = actor(req);
  res.json({
    user: publicUser(user),
    policy: {
      commission: config.platformCommission,
      minPayout: config.minPayoutAmount,
      payoutFee: config.payoutFeeFlat,
      paymentWindowMinutes: config.paymentWindowMinutes,
      autoReleaseHours: config.autoReleaseHours,
      refundPolicy: describeRefundPolicy(),
      refundTiers: config.refundTiers,
      categories: CATEGORIES,
      maxImages: config.maxProductImages,
      supportUrl: marketplace.supportLink(),
    },
  });
});

const settingsSchema = z.object({
  language: z.enum(['uz', 'ru']).optional(),
  becomeSeller: z.literal(true).optional(),
  notificationSettings: z
    .object({
      newOrder: z.boolean().optional(),
      paymentConfirm: z.boolean().optional(),
      refundUpdate: z.boolean().optional(),
      promo: z.boolean().optional(),
    })
    .optional(),
});

router.patch('/settings', writeLimiter, async (req: Request, res: Response) => {
  try {
    const data = parse(settingsSchema, req.body);
    const user = actor(req);

    if (data.language) user.language = data.language;
    // Role can only be upgraded buyer → seller here. Admin/moderator is never grantable
    // through a user-facing endpoint, whatever the request body says.
    if (data.becomeSeller && user.role === 'buyer') user.role = 'seller';
    if (data.notificationSettings) {
      user.notificationSettings = { ...user.notificationSettings, ...data.notificationSettings };
    }

    await user.save();
    res.json({ user: publicUser(user) });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

// ── Buying ─────────────────────────────────────────────────────────────────────

const purchaseSchema = z.object({
  productId: z.string().regex(/^[a-f\d]{24}$/i, 'Mahsulot topilmadi'),
  // Required for private deals, ignored for public listings.
  code: z.string().min(4).max(20).optional(),
});

/**
 * Opens a purchase and returns the payment instructions.
 *
 * The full card number is included — unlike the catalog, which never exposes it — because the
 * buyer cannot make the transfer without it. It is released only to an authenticated buyer who
 * just won the reservation on this specific listing, and it is the platform's own receiving
 * card, not a user's.
 */
router.post('/purchases', writeLimiter, async (req: Request, res: Response) => {
  try {
    const { productId, code } = parse(purchaseSchema, req.body);
    const user = actor(req);

    const { transaction, product, uniqueAmount, card, expiresAt } = await paymentService.createPaymentTransaction(
      productId,
      String(user._id),
      code
    );

    res.json({
      transactionId: String(transaction._id),
      paymentProvider: transaction.paymentProvider,
      paymentAmount: uniqueAmount,
      product: { id: String(product._id), title: product.title, price: product.price },
      uniqueAmount,
      expiresAt,
      card: card ? { number: card.raw, masked: card.masked, holder: card.holder, bank: card.bank } : null,
      paymentWindowMinutes: config.paymentWindowMinutes,
    });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

const codeSchema = z.object({ code: z.string().min(4).max(20) });

/** Resolves a private deal code, then hands back exactly what the bot's code wizard shows. */
router.post('/deals/lookup', codeLimiter, async (req: Request, res: Response) => {
  try {
    const { code } = parse(codeSchema, req.body);
    const user = actor(req);

    const deal = await marketplace.findDealByCode(code);
    if (!deal) return res.status(404).json({ error: 'Bunday kod topilmadi yoki bitim yopilgan' });

    const isOwnDeal = String((deal.sellerId as any)?._id || deal.sellerId) === String(user._id);
    if (isOwnDeal && !config.allowSelfPurchase) {
      return res.status(403).json({ error: 'Bu sizning o‘z bitimingiz — uni sotib ololmaysiz' });
    }

    const seller = deal.sellerId as any;
    const ratingCount = seller?.sellerStats?.ratingCount ?? 0;

    res.json({
      deal: {
        id: String(deal._id),
        title: deal.title,
        price: deal.price,
        images: deal.images,
        isOwnDeal,
        seller: seller
          ? {
              username: seller.username,
              trustLevel: seller.trustLevel,
              sold: seller.sellerStats?.sold ?? 0,
              rating: ratingCount ? Math.round((seller.sellerStats.ratingSum / ratingCount) * 10) / 10 : null,
              ratingCount,
            }
          : null,
      },
      refundPolicy: describeRefundPolicy(),
    });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

// ── Orders ─────────────────────────────────────────────────────────────────────

/** Loads an escrow hold only if the caller is its buyer. Every order route starts here. */
async function ownedEscrow(req: Request, res: Response) {
  const user = actor(req);
  const hold = await EscrowHold.findById(req.params.id).catch(() => null);
  if (!hold) {
    res.status(404).json({ error: 'Buyurtma topilmadi' });
    return null;
  }
  if (String(hold.buyerId) !== String(user._id)) {
    // Deliberately the same 404 an unknown id gets: a different answer here would confirm
    // that some other user's order exists at this id.
    res.status(404).json({ error: 'Buyurtma topilmadi' });
    return null;
  }
  return hold;
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  holding: 'Kafilda saqlanmoqda',
  released: 'Yakunlangan',
  refunded: 'Qaytarilgan',
  partial_refunded: 'Qisman qaytarilgan',
  disputed: 'Nizoda',
};

router.get('/orders', async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    const [holds, pending] = await Promise.all([
      EscrowHold.find({ buyerId: user._id }).sort('-createdAt').limit(50).populate('productId', 'title price images'),
      Transaction.find({ buyerId: user._id, status: { $in: ['pending_payment', 'expired'] } })
        .sort('-createdAt')
        .limit(10)
        .populate('productId', 'title price'),
    ]);

    res.json({
      orders: holds.map((hold) => {
        const product = hold.productId as any;
        return {
          id: String(hold._id),
          status: hold.status,
          statusLabel: ORDER_STATUS_LABEL[hold.status] || hold.status,
          title: product?.title || 'Mahsulot',
          image: product?.images?.[0] || null,
          amount: hold.amount,
          boughtAt: hold.boughtAt,
          revealedAt: hold.credentialsRevealedAt || null,
          autoReleaseAt: hold.autoReleaseAt,
          rated: Boolean(hold.buyerRating),
          rating: hold.buyerRating || null,
        };
      }),
      pending: pending.map((t) => ({
        id: String(t._id),
        status: t.status,
        title: (t.productId as any)?.title || 'Mahsulot',
        uniqueAmount: t.uniqueAmount,
        paymentAmount: t.paymentProvider === 'hamyon' ? t.hamyonAmount ?? t.uniqueAmount : t.uniqueAmount,
        paymentProvider: t.paymentProvider,
        paymentReview: Boolean(t.paymentReview),
        createdAt: t.createdAt,
        expireAt: t.expireAt,
      })),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

/**
 * Polled by the payment screen while the buyer makes the transfer. Confirmation is driven by
 * the bank SMS webhook, so the browser has no other way to learn that the money landed.
 */
router.get('/transactions/:id/status', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    const transaction = await Transaction.findOne({ _id: req.params.id, buyerId: user._id }).populate(
      'productId',
      'title'
    );
    if (!transaction) return res.status(404).json({ error: 'Buyurtma topilmadi' });

    const hold =
      transaction.status === 'paid' || transaction.status === 'completed'
        ? await EscrowHold.findOne({ transactionId: transaction._id })
        : null;

    // The destination card is re-served while (and only while) the transfer is still owed, so
    // a buyer who closed the tab can finish paying without opening a second order.
    const card =
      transaction.status === 'pending_payment' && transaction.paymentProvider === 'sms'
        ? config.paymentCards.find((c) => c.id === transaction.cardId) || config.paymentCards[0]
        : null;
    const hamyonCard =
      transaction.status === 'pending_payment' && transaction.paymentProvider === 'hamyon' && transaction.hamyonCard
        ? { number: transaction.hamyonCard, masked: maskCard(transaction.hamyonCard), holder: '', bank: '' }
        : null;

    res.json({
      status: transaction.status,
      paymentProvider: transaction.paymentProvider,
      // The exact amount to send (HamyonAPI: price plus a few so'm to keep open payments distinct).
      paymentAmount: transaction.paymentProvider === 'hamyon' ? transaction.hamyonAmount : transaction.basePrice,
      basePrice: transaction.basePrice,
      productId: String(transaction.productId && (transaction.productId as any)._id || transaction.productId),
      cancelReason: transaction.status === 'expired' || transaction.status === 'cancelled' ? transaction.cancelReason || null : null,
      paymentReview: Boolean(transaction.paymentReview),
      title: (transaction.productId as any)?.title || 'Mahsulot',
      uniqueAmount: transaction.uniqueAmount,
      expireAt: transaction.expireAt,
      orderId: hold ? String(hold._id) : null,
      card: hamyonCard || (card
        ? { number: card.number, masked: maskCard(card.number), holder: card.holder, bank: card.bank }
        : null),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

router.get('/orders/:id', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const hold = await ownedEscrow(req, res);
    if (!hold) return;

    const product = await Product.findById(hold.productId).select('-sensitiveData');
    const quote = hold.status === 'holding' ? await paymentService.quoteRefundFor(String(hold._id)) : null;

    res.json({
      order: {
        id: String(hold._id),
        status: hold.status,
        statusLabel: ORDER_STATUS_LABEL[hold.status] || hold.status,
        amount: hold.amount,
        boughtAt: hold.boughtAt,
        revealedAt: hold.credentialsRevealedAt || null,
        autoReleaseAt: hold.autoReleaseAt,
        refundDeadlineAt: hold.refundDeadlineAt,
        rated: Boolean(hold.buyerRating),
        rating: hold.buyerRating || null,
        refundReason: hold.refundReason || null,
        product: product
          ? { id: String(product._id), title: product.title, description: product.description, images: product.images }
          : null,
      },
      refundQuote: quote,
      refundPolicy: describeRefundPolicy(),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

/**
 * Hands the buyer the account credentials and starts the refund clock — the web twin of the
 * bot's "🔑 Ma'lumotlarni ochish". Ownership, escrow state and the clock all live in
 * paymentService.revealCredentials; this route adds only transport concerns.
 */
router.post('/orders/:id/reveal', revealLimiter, validateObjectId(), async (req: Request, res: Response) => {
  try {
    const hold = await ownedEscrow(req, res);
    if (!hold) return;
    const user = actor(req);

    const { credentials, hold: updated, firstReveal } = await paymentService.revealCredentials(
      String(hold._id),
      String(user._id)
    );

    if (firstReveal) {
      const seller = await User.findById(updated.sellerId);
      const product = await Product.findById(updated.productId);
      if (seller?.telegramId) {
        await notificationService.notifySeller(
          seller.telegramId,
          `👀 <b>Xaridor ma’lumotlarni ochdi</b> (saytda)\n\n` +
            `Mahsulot: ${escapeHtml(product?.title || '—')}\n` +
            `E’tiroz bo‘lmasa, <b>${formatUzs(updated.sellerPayout)}</b> balansingizga o‘tadi.`
        );
      }
    }

    res.json({
      credentials,
      firstReveal,
      autoReleaseAt: updated.autoReleaseAt,
      refundPolicy: describeRefundPolicy(),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

router.post('/orders/:id/confirm', writeLimiter, validateObjectId(), async (req: Request, res: Response) => {
  try {
    const hold = await ownedEscrow(req, res);
    if (!hold) return;
    const user = actor(req);

    const result = await paymentService.confirmAndRelease(String(hold._id), String(user._id));

    const seller = await User.findById(hold.sellerId);
    const product = await Product.findById(hold.productId);
    if (seller?.telegramId) {
      await notificationService.notifySeller(
        seller.telegramId,
        `✅ <b>Xaridor bitimni tasdiqladi!</b> (saytda)\n\n` +
          `Mahsulot: ${escapeHtml(product?.title || '—')}\n` +
          `Balansingizga: <b>${formatUzs(result.sellerPayout)}</b>\n` +
          `Komissiya (${config.platformCommission}%): ${formatUzs(result.commission)}`
      );
    }

    res.json({ released: true, sellerPayout: result.sellerPayout, commission: result.commission });
  } catch (error: any) {
    return fail(res, error);
  }
});

router.get('/orders/:id/refund-quote', validateObjectId(), async (req: Request, res: Response) => {
  try {
    const hold = await ownedEscrow(req, res);
    if (!hold) return;
    res.json({ quote: await paymentService.quoteRefundFor(String(hold._id)) });
  } catch (error: any) {
    return fail(res, error);
  }
});

/** The four reasons the bot offers, kept as an enum so free text can't reach the audit log. */
export const REFUND_REASONS: Record<string, string> = {
  not_working: 'Akkaunt ishlamayapti (login/parol noto‘g‘ri)',
  wrong_info: 'E’londagi ma’lumot haqiqatga mos emas',
  recovered: 'Asl egasi akkauntni qaytarib oldi',
  other: 'Boshqa sabab',
};

const refundSchema = z.object({
  reasonType: z.enum(['not_working', 'wrong_info', 'recovered', 'other'], {
    errorMap: () => ({ message: 'Sababni tanlang' }),
  }),
});

router.post('/orders/:id/refund', writeLimiter, validateObjectId(), async (req: Request, res: Response) => {
  try {
    const { reasonType } = parse(refundSchema, req.body);
    const hold = await ownedEscrow(req, res);
    if (!hold) return;
    const user = actor(req);
    const reason = REFUND_REASONS[reasonType];

    const result = await paymentService.processRefund(String(hold._id), reason, String(user._id));
    if (!result.allowed) {
      return res.status(409).json({ error: result.message, quote: result.quote });
    }

    const [buyer, seller, product] = await Promise.all([
      User.findById(hold.buyerId),
      User.findById(hold.sellerId),
      Product.findById(hold.productId),
    ]);

    await notificationService.notifyRefundToAdmin({
      buyer: `@${buyer?.username || buyer?.telegramId}`,
      seller: `@${seller?.username || seller?.telegramId}`,
      productTitle: product?.title || '—',
      amount: hold.amount,
      reason,
      quote: result.quote,
      escrowId: String(hold._id),
      sellerId: String(hold.sellerId),
      productId: String(hold.productId),
    });

    if (seller?.telegramId) {
      await notificationService.notifySeller(
        seller.telegramId,
        [
          `🔄 <b>Xaridor qaytarish so‘radi</b> (saytda)`,
          '',
          `Mahsulot: ${escapeHtml(product?.title || '—')}`,
          `Sabab: ${reason}`,
          `Sizga kompensatsiya: <b>${formatUzs(result.sellerKeeps ?? 0)}</b>`,
          '',
          `<i>Dalil bilan nizo ochish: ${marketplace.supportLink()}</i>`,
        ].join('\n')
      );
    }

    res.json({
      refunded: true,
      refundToBuyer: result.refundToBuyer,
      penaltyAmount: result.penaltyAmount,
      period: result.period,
    });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

const rateSchema = z.object({
  rating: z.number().int().min(1, 'Baho 1 dan 5 gacha').max(5, 'Baho 1 dan 5 gacha'),
});

router.post('/orders/:id/rate', writeLimiter, validateObjectId(), async (req: Request, res: Response) => {
  try {
    const { rating } = parse(rateSchema, req.body);
    const hold = await ownedEscrow(req, res);
    if (!hold) return;

    if (!(await marketplace.rateHold(String(hold._id), rating))) {
      return res.status(409).json({ error: 'Bahoni faqat yakunlangan bitimga bir marta berish mumkin' });
    }

    res.json({ ok: true, rating });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

// ── Selling ────────────────────────────────────────────────────────────────────

router.get('/listings', async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    const products = await marketplace.getUserProducts(String(user._id));

    res.json({
      listings: products.map((p: any) => ({
        id: String(p._id),
        listingCode: p.listingCode,
        title: p.title,
        price: p.price,
        category: p.category,
        status: p.status,
        listingType: p.listingType,
        images: p.images,
        viewCount: p.viewCount,
        createdAt: p.createdAt,
        moderationNote: p.moderationNote || null,
        // Only a live, unclaimed private deal still has a usable code.
        dealCode:
          p.listingType === 'private' && p.dealCode && p.status === 'active' ? formatDealCode(p.dealCode) : null,
        dealExpiresAt: p.dealExpiresAt || null,
      })),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

/**
 * Images arrive as URLs from `POST /me/uploads`. They are re-checked here against our own
 * Cloudinary account: without this, the field is a free "put any URL you like on a page we
 * serve" primitive — a tracking pixel, or a link to something we would rather not host.
 */
const CLOUDINARY_HOST = 'res.cloudinary.com';
const imageUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.hostname === CLOUDINARY_HOST &&
        (!config.cloudinaryCloudName || url.pathname.startsWith(`/${config.cloudinaryCloudName}/`))
      );
    } catch {
      return false;
    }
  }, 'Rasm manzili noto‘g‘ri');

const credentialsSchema = {
  login: z.string().trim().min(1, 'Loginni kiriting').max(200),
  password: z.string().min(1, 'Parolni kiriting').max(200),
  recoveryCode: z.string().trim().max(300).optional().or(z.literal('')),
};

const listingSchema = z.object({
  title: z.string().trim().min(5, 'Nom 5–120 belgi bo‘lishi kerak').max(120, 'Nom 5–120 belgi bo‘lishi kerak'),
  description: z.string().trim().min(20, 'Tavsif kamida 20 belgi').max(4000),
  price: z.number().int().min(1000, 'Minimal narx 1 000 UZS').max(1_000_000_000),
  category: z.enum(CATEGORIES as [string, ...string[]], {
    errorMap: () => ({ message: 'Ro‘yxatdagi kategoriyalardan birini tanlang' }),
  }),
  images: z.array(imageUrlSchema).max(config.maxProductImages).optional(),
  ...credentialsSchema,
});

router.post('/listings', writeLimiter, async (req: Request, res: Response) => {
  try {
    const data = parse(listingSchema, req.body);
    const user = actor(req);

    if (user.role === 'buyer') {
      user.role = 'seller';
      await user.save();
    }

    const product = await marketplace.createProduct({
      sellerId: String(user._id),
      title: data.title,
      description: data.description,
      price: data.price,
      category: data.category,
      login: data.login,
      password: data.password,
      recoveryCode: data.recoveryCode || undefined,
      images: data.images || [],
    });

    await notificationService.notifyAdmin(
      `🆕 <b>Yangi e’lon katalogda</b> (saytdan)\n\n` +
        `${escapeHtml(product.title)}\n${formatUzs(product.price)}\n` +
        `Sotuvchi: @${escapeHtml(user.username || String(user.telegramId))} (${user.trustLevel})\n\n` +
        `<i>E’lon katalogda chop etildi.</i>`
    );

    res.status(201).json({ id: String(product._id), listingCode: product.listingCode, status: product.status });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

const dealSchema = z.object({
  title: z.string().trim().min(3, 'Nom 3–120 belgi bo‘lishi kerak').max(120, 'Nom 3–120 belgi bo‘lishi kerak'),
  price: z.number().int().min(1000, 'Minimal summa 1 000 UZS').max(1_000_000_000),
  images: z.array(imageUrlSchema).max(config.maxProductImages).optional(),
  ...credentialsSchema,
});

router.post('/deals', writeLimiter, async (req: Request, res: Response) => {
  try {
    const data = parse(dealSchema, req.body);
    const user = actor(req);

    if (user.role === 'buyer') {
      user.role = 'seller';
      await user.save();
    }

    const deal = await marketplace.createDeal({
      sellerId: String(user._id),
      title: data.title,
      price: data.price,
      login: data.login,
      password: data.password,
      recoveryCode: data.recoveryCode || undefined,
      images: data.images || [],
    });

    const commission = Math.round((deal.price * config.platformCommission) / 100);
    res.status(201).json({
      id: String(deal._id),
      title: deal.title,
      price: deal.price,
      sellerPayout: deal.price - commission,
      commission,
      dealCode: formatDealCode(deal.dealCode!),
      expiresAt: deal.dealExpiresAt,
      shareText:
        `🤝 Bitmax kafil bitimi\n${deal.title}\nSumma: ${formatUzs(deal.price)}\n` +
        `Kod: ${formatDealCode(deal.dealCode!)}\n\n${config.siteUrl}/kod`,
    });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

router.post('/listings/:id/cancel', writeLimiter, validateObjectId(), async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    // Scoped by sellerId inside cancelDeal, so an id belonging to somebody else matches nothing.
    const cancelled = await marketplace.cancelListing(req.params.id, String(user._id));
    if (!cancelled) return res.status(409).json({ error: 'E’lon topilmadi, band qilingan yoki savdo boshlangan' });
    res.json({ ok: true });
  } catch (error: any) {
    return fail(res, error);
  }
});

router.get('/sales', async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    const holds = await EscrowHold.find({ sellerId: user._id })
      .sort('-createdAt')
      .limit(50)
      .populate('productId', 'title');

    res.json({
      sales: holds.map((hold) => ({
        id: String(hold._id),
        title: (hold.productId as any)?.title || 'Mahsulot',
        status: hold.status,
        statusLabel: ORDER_STATUS_LABEL[hold.status] || hold.status,
        amount: hold.amount,
        sellerPayout: hold.sellerPayout,
        commission: hold.commission,
        boughtAt: hold.boughtAt,
        revealedAt: hold.credentialsRevealedAt || null,
        autoReleaseAt: hold.autoReleaseAt,
        rating: hold.buyerRating || null,
      })),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

// ── Wallet ─────────────────────────────────────────────────────────────────────

const LEDGER_LABEL: Record<string, string> = {
  escrow_release: 'Sotuvdan daromad',
  escrow_refund: 'Qaytarish',
  payout_reserved: 'Pul yechish',
  payout_reverted: 'Yechish bekor qilindi',
  manual_adjustment: 'Admin tuzatishi',
};

router.get('/wallet', async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    const [entries, payouts] = await Promise.all([
      ledgerService.statement(String(user._id), 25),
      Payout.find({ userId: user._id }).sort('-createdAt').limit(10),
    ]);

    res.json({
      balance: user.balance,
      totalEarned: user.totalEarned,
      totalSpent: user.totalSpent,
      minPayout: config.minPayoutAmount,
      payoutFee: config.payoutFeeFlat,
      card: user.payoutCard?.masked ? { masked: user.payoutCard.masked, holder: user.payoutCard.holder } : null,
      entries: entries.map((entry: any) => ({
        id: String(entry._id),
        amount: entry.amount,
        type: entry.type,
        label: LEDGER_LABEL[entry.type] || entry.type,
        createdAt: entry.createdAt,
      })),
      payouts: payouts.map((payout) => ({
        id: String(payout._id),
        amount: payout.amount,
        netAmount: payout.netAmount,
        status: payout.status,
        destinationMasked: payout.destinationMasked,
        requestedAt: payout.requestedAt,
        processedAt: payout.processedAt || null,
      })),
    });
  } catch (error: any) {
    return fail(res, error);
  }
});

const cardSchema = z.object({
  cardNumber: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((digits) => digits.length === 16, 'Karta raqami 16 xonali bo‘lishi kerak'),
  holder: z.string().trim().min(3, 'Karta egasining ismini to‘liq kiriting').max(80),
});

router.post('/payout-card', writeLimiter, async (req: Request, res: Response) => {
  try {
    const { cardNumber, holder } = parse(cardSchema, req.body);
    const user = actor(req);
    await payoutService.setPayoutCard(String(user._id), cardNumber, holder);
    // Only the masked form ever goes back over the wire, here as everywhere else.
    res.json({ card: { masked: maskCard(cardNumber), holder } });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    return fail(res, error);
  }
});

const payoutSchema = z.object({ amount: z.number().int().min(1).max(1_000_000_000) });

router.post('/payouts', writeLimiter, async (req: Request, res: Response) => {
  try {
    const { amount } = parse(payoutSchema, req.body);
    const user = actor(req);

    const payout = await payoutService.requestPayout(String(user._id), amount);
    res.status(201).json({
      id: String(payout._id),
      amount: payout.amount,
      netAmount: payout.netAmount,
      destinationMasked: payout.destinationMasked,
      status: payout.status,
    });
  } catch (error: any) {
    if (badRequest(res, error)) return;
    // payoutService signals its user-facing rules (minimum amount, no card saved, blocked
    // account) as plain Errors carrying an Uzbek message meant for the user. Anything else —
    // a driver error, a bug — is a base-class Error too, so the check stays narrow: plain
    // `Error`, short message, nothing else forwarded.
    if (error?.name === 'Error' && typeof error.message === 'string' && error.message.length <= 200) {
      return res.status(400).json({ error: error.message });
    }
    return fail(res, error);
  }
});

// ── Image upload ───────────────────────────────────────────────────────────────

/**
 * Raw image bytes, capped at 5 MB and type-checked from the file header before anything is
 * forwarded. `express.json` stays at 100 kb globally; this is the only route that accepts a
 * large body, and only these three content types.
 */
router.post(
  '/uploads',
  uploadLimiter,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  async (req: Request, res: Response) => {
    try {
      const bytes = req.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'Rasm yuborilmadi (JPG, PNG yoki WEBP)' });
      }
      const url = await uploadImageBuffer(bytes);
      res.status(201).json({ url });
    } catch (error: any) {
      return fail(res, error, 'Rasm yuklanmadi');
    }
  }
);

export default router;
