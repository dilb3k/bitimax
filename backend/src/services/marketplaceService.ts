import crypto from 'crypto';
import { User, IUser } from '../models/User';
import { Product } from '../models/Product';
import { Transaction } from '../models/Transaction';
import { EscrowHold } from '../models/EscrowHold';
import { paymentService } from './paymentService';
import { config, CATEGORIES } from '../config';
import { audit } from '../models/AuditLog';
import { encryptSecret } from '../utils/crypto';
import { generateDealCode, normalizeDealCode } from '../utils/helpers';

export class BlockedUserError extends Error {
  constructor(reason?: string) {
    super(reason || 'Hisobingiz bloklangan');
    this.name = 'BlockedUserError';
  }
}

export class MarketplaceService {
  async getOrCreateUser(telegramId: number, ctx: any): Promise<IUser> {
    const from = ctx.from || {};

    // Upsert so two updates arriving at once for a brand-new user can't create duplicates.
    const user = await User.findOneAndUpdate(
      { telegramId },
      {
        $set: {
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          lastSeenAt: new Date(),
        },
        $setOnInsert: {
          role: 'buyer',
          language: from.language_code === 'ru' ? 'ru' : 'uz',
          referralCode: crypto.randomBytes(4).toString('hex'),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return user;
  }

  /**
   * Every entry point calls this. `isBlocked` existed in v1 but was never checked anywhere,
   * so blocking a scammer changed a boolean and nothing else — they kept trading.
   */
  assertNotBlocked(user: IUser) {
    if (user.isBlocked) throw new BlockedUserError(user.blockReason);
  }

  async createProduct(data: {
    productId?: string;
    sellerId: string;
    title: string;
    description: string;
    price: number;
    category: string;
    login: string;
    password: string;
    recoveryCode?: string;
    additionalInfo?: string;
    tags?: string[];
    images?: string[];
  }) {
    if (data.productId) {
      const existing = await Product.findOne({ _id: data.productId, sellerId: data.sellerId });
      if (existing) return existing;
    }
    const product = new Product({
      ...(data.productId ? { _id: data.productId } : {}),
      sellerId: data.sellerId,
      title: data.title,
      description: data.description,
      price: data.price,
      category: data.category,
      tags: data.tags || [],
      images: data.images || [],
      // Seller reviews the listing before confirming publication.
      status: 'active',
    });

    // Goes through the model method so credentials are encrypted before they ever touch disk.
    product.setCredentials({
      login: data.login,
      password: data.password,
      recoveryCode: data.recoveryCode,
      additionalInfo: data.additionalInfo,
    });

    try { await product.save(); } catch (error: any) {
      if (error?.code === 11000 && data.productId) {
        const existing = await Product.findOne({ _id: data.productId, sellerId: data.sellerId });
        if (existing) return existing;
      }
      throw error;
    }
    await User.findByIdAndUpdate(data.sellerId, { $inc: { 'sellerStats.listed': 1 } });

    return product;
  }

  /**
   * Creates a private escrow deal: no catalog listing, no moderation, reachable only by the
   * code the seller passes to the one buyer they already agreed with.
   *
   * Moderation is skipped deliberately. Its job is to protect strangers browsing a catalog
   * from a fake listing; here there is no stranger — the buyer chose this seller and this
   * account before Bitmax was involved, and all they want is the escrow in the middle.
   */
  async createDeal(data: {
    sellerId: string;
    title: string;
    price: number;
    description?: string;
    category?: string;
    login: string;
    password: string;
    recoveryCode?: string;
    images?: string[];
  }) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const dealCode = generateDealCode();
      const product = new Product({
        sellerId: data.sellerId,
        title: data.title,
        description: data.description || `Kelishilgan bitim: ${data.title}`,
        price: data.price,
        category: data.category || 'Boshqa',
        images: data.images || [],
        listingType: 'private',
        dealCode,
        // An unclaimed code shouldn't stay live forever — the seller's credentials are sitting
        // in it. A week is long enough for any real handover.
        dealExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
        status: 'active',
      });

      product.setCredentials({
        login: data.login,
        password: data.password,
        recoveryCode: data.recoveryCode,
      });

      try {
        await product.save();
        await User.findByIdAndUpdate(data.sellerId, { $inc: { 'sellerStats.listed': 1 } });
        return product;
      } catch (err: any) {
        // E11000 = the generated code collided with an existing one; draw another.
        if (err?.code === 11000) continue;
        throw err;
      }
    }
    throw new Error('Bitim kodini yaratib bo‘lmadi, qayta urinib ko‘ring');
  }

  /** Resolves a buyer-typed code to a live deal. Returns null for anything not purchasable. */
  async findDealByCode(code: string) {
    const normalized = normalizeDealCode(code);
    if (normalized.length !== 8) return null;

    return Product.findOne({
      dealCode: normalized,
      listingType: 'private',
      status: { $in: ['active', 'reserved'] },
    }).populate('sellerId', 'telegramId username trustLevel sellerStats');
  }

  /**
   * Why a code that does not resolve is unusable right now, so the buyer is told something
   * actionable instead of the same "not found" for every case.
   */
  async diagnoseDealCode(code: string): Promise<'reserved' | 'expired' | null> {
    const normalized = normalizeDealCode(code);
    if (normalized.length !== 8) return null;
    const deal = await Product.findOne({ dealCode: normalized, listingType: 'private' }).select('status archiveReason');
    if (!deal) return null;
    if (deal.status === 'reserved') return 'reserved';
    if (deal.status === 'archived' && deal.archiveReason === 'expired') return 'expired';
    return null;
  }

  /** Seller cancels their own unclaimed deal, invalidating the code. */
  async cancelDeal(productId: string, sellerId: string) {
    return this.cancelListing(productId, sellerId);
  }

  /**
   * Edits a listing the seller still owns outright. One conditional update decides it: the
   * product must be unsold and unreserved *at the moment of the write*, so a buyer who reserves
   * it a millisecond earlier wins and the edit is refused (returns null) instead of changing
   * the terms under someone who is already paying.
   *
   * Credentials are re-encrypted individually, so editing only the password keeps the login.
   */
  async updateListing(
    productId: string,
    sellerId: string,
    patch: {
      title?: string;
      description?: string;
      price?: number;
      category?: string;
      images?: string[];
      login?: string;
      password?: string;
    }
  ) {
    const set: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length < 3 || title.length > 120) throw Object.assign(new Error('Nom 3–120 belgi bo‘lsin'), { status: 400 });
      set.title = title;
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description.length < 20 || description.length > 4000) {
        throw Object.assign(new Error('Tavsif 20–4000 belgi bo‘lsin'), { status: 400 });
      }
      set.description = description;
    }
    if (patch.price !== undefined) {
      if (!Number.isSafeInteger(patch.price) || patch.price < 1000 || patch.price > 1_000_000_000) {
        throw Object.assign(new Error('Narx 1 000–1 000 000 000 so‘m orasida bo‘lsin'), { status: 400 });
      }
      set.price = patch.price;
    }
    if (patch.category !== undefined) {
      if (!(CATEGORIES as readonly string[]).includes(patch.category)) {
        throw Object.assign(new Error('Kategoriya noto‘g‘ri'), { status: 400 });
      }
      set.category = patch.category;
    }
    if (patch.images !== undefined) {
      if (patch.images.length > config.maxProductImages) {
        throw Object.assign(new Error(`Ko‘pi bilan ${config.maxProductImages} ta rasm`), { status: 400 });
      }
      set.images = patch.images;
    }
    if (patch.login !== undefined) {
      if (!patch.login.length || patch.login.length > 200) throw Object.assign(new Error('Login 1–200 belgi bo‘lsin'), { status: 400 });
      set['sensitiveData.login'] = encryptSecret(patch.login);
    }
    if (patch.password !== undefined) {
      if (!patch.password.length || patch.password.length > 200) throw Object.assign(new Error('Parol 1–200 belgi bo‘lsin'), { status: 400 });
      set['sensitiveData.password'] = encryptSecret(patch.password);
    }
    if (Object.keys(set).length === 0) throw Object.assign(new Error('O‘zgartirish yo‘q'), { status: 400 });

    const updated = await Product.findOneAndUpdate(
      { _id: productId, sellerId, status: { $in: ['active', 'pending_review', 'draft', 'rejected'] } },
      { $set: set },
      { new: true }
    );
    if (updated) {
      // Never log credential values, only which fields changed.
      await audit({
        actorId: updated.sellerId as any,
        action: 'product.edited',
        targetType: 'Product',
        targetId: updated._id as any,
        after: { fields: Object.keys(set).map((key) => key.replace('sensitiveData.', 'credentials.')) },
      });
    }
    return updated;
  }

  async cancelListing(productId: string, sellerId: string) {
    return Product.findOneAndUpdate(
      { _id: productId, sellerId, status: { $in: ['active', 'pending_review', 'draft', 'rejected'] } },
      { $set: { status: 'archived', archiveReason: 'cancelled' }, $unset: { dealCode: '' } },
      { new: true }
    );
  }

  /**
   * Brings an expired private deal back: same code, fresh deadline. Only deals that lapsed on
   * their own can be reopened — one the seller cancelled lost its code on purpose.
   */
  async reopenDeal(productId: string, sellerId: string) {
    return Product.findOneAndUpdate(
      {
        _id: productId,
        sellerId,
        listingType: 'private',
        status: 'archived',
        archiveReason: 'expired',
        dealCode: { $exists: true },
        // Credentials wiped by the retention job cannot be sold again.
        credentialsPurgedAt: { $exists: false },
      },
      { $set: { status: 'active', dealExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000) }, $unset: { archiveReason: '' } },
      { new: true }
    );
  }

  /**
   * Turns a private deal (or an archived one) into an ordinary catalog listing. The code stops
   * working and is removed, since the account is no longer reserved for one agreed buyer.
   * Refused while a buyer holds a reservation: status must be active or archived.
   */
  async publishListing(productId: string, sellerId: string) {
    const existing = await Product.findOne({ _id: productId, sellerId }).select('description');
    if (existing && existing.description.trim().length < 20) {
      throw Object.assign(new Error('Katalogga chiqarish uchun avval tavsifni to‘ldiring (kamida 20 belgi)'), { status: 400 });
    }
    return Product.findOneAndUpdate(
      { _id: productId, sellerId, listingType: 'private', status: { $in: ['active', 'archived'] }, credentialsPurgedAt: { $exists: false } },
      {
        $set: { listingType: 'public', status: 'active' },
        $unset: { dealCode: '', dealExpiresAt: '', archiveReason: '' },
      },
      { new: true }
    );
  }

  async getActiveProducts(page = 1, limit = 10, category?: string) {
    // Public catalog only — a private deal is reachable by its code and nowhere else.
    const filter: Record<string, unknown> = { status: 'active', listingType: 'public' };
    if (category) filter.category = category;

    const total = await Product.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / limit));
    page = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
    const products = await Product.find(filter)
        .select('-sensitiveData')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('sellerId', 'telegramId username trustLevel sellerStats');

    return { products, total, pages, page };
  }

  async getUserProducts(userId: string) {
    return Product.find({ sellerId: userId }).select('-sensitiveData').sort('-createdAt').limit(50);
  }

  async getUserTransactions(userId: string, role: 'buyer' | 'seller') {
    const filter = role === 'buyer' ? { buyerId: userId } : { sellerId: userId };
    return Transaction.find(filter).sort('-createdAt').limit(50).populate('productId', 'title price');
  }

  async getEscrowHolds(userId: string, role: 'buyer' | 'seller') {
    const filter = role === 'buyer' ? { buyerId: userId } : { sellerId: userId };
    return EscrowHold.find(filter).sort('-createdAt').limit(50).populate('productId', 'title price');
  }

  /**
   * Opens a purchase. The reservation and the unique-amount allocation both live in
   * paymentService, which is also where the product-availability check happens atomically —
   * checking here first would only add a race window.
   */
  async initiatePurchase(productId: string, buyerId: string, dealCode?: string) {
    return paymentService.createPaymentTransaction(productId, buyerId, dealCode);
  }

  /**
   * Records the buyer's rating once. The conditional update (not read-modify-write) is what stops
   * two quick taps from counting twice in the seller's average. Returns false if the hold was
   * already rated or is not finished yet.
   */
  async rateHold(holdId: string, rating: number): Promise<boolean> {
    const claimed = await EscrowHold.findOneAndUpdate(
      { _id: holdId, buyerRating: { $exists: false }, status: { $in: ['released', 'refunded', 'partial_refunded'] } },
      { $set: { buyerRating: rating } },
      { new: true }
    );
    if (!claimed) return false;
    await User.findByIdAndUpdate(claimed.sellerId, {
      $inc: { 'sellerStats.ratingSum': rating, 'sellerStats.ratingCount': 1 },
    });
    return true;
  }

  supportLink(): string {
    return `https://t.me/${config.supportUsername}`;
  }
}

export const marketplace = new MarketplaceService();
