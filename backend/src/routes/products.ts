import { Router, Request, Response } from 'express';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { validateObjectId } from '../middleware/validateObjectId';
import { config } from '../config';

const router = Router();

// Public policy contains only trading rules; credentials and provider configuration stay private.
router.get('/policy', (_req: Request, res: Response) => {
  res.json({
    commission: config.platformCommission,
    paymentProvider: config.paymentProvider,
    paymentWindowMinutes: config.paymentWindowMinutes,
    autoReleaseHours: config.autoReleaseHours,
    unrevealedGraceHours: config.unrevealedGraceHours,
    refundTiers: config.refundTiers,
  });
});

const ALLOWED_SORT = new Set(['-createdAt', 'createdAt', '-price', 'price']);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '20', category, search, sort = '-createdAt', minPrice, maxPrice } =
      req.query;

    // Private deals are reachable only by their code and must never appear in the catalog,
    // so listingType leads every public query rather than being an afterthought filter.
    const filter: any = { status: 'active', listingType: 'public' };
    if (typeof category === 'string' && category) filter.category = category.slice(0, 60);

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Math.max(0, parseInt(minPrice as string, 10) || 0);
      if (maxPrice) filter.price.$lte = Math.max(0, parseInt(maxPrice as string, 10) || 0);
    }

    // Uses the text index rather than an unindexed $regex collection scan. The old version
    // escaped the input (good) but still forced a full scan of every product on every search,
    // which stops being viable the moment the catalog grows.
    let projection: any = null;
    let sortValue: any = ALLOWED_SORT.has(sort as string) ? (sort as string) : '-createdAt';

    if (search && typeof search === 'string') {
      const term = search.trim().slice(0, 200);
      if (term.length > 0) {
        if (/^(?:[1-9]\d{5}|[A-Z][A-Z\d]{5})$/i.test(term.replace(/^#/, '')) && (/\d/.test(term) || term.startsWith('#'))) {
          filter.listingCode = term.replace(/^#/, '').toUpperCase();
          projection = null;
        } else filter.$text = { $search: term };
        if (filter.$text) projection = { score: { $meta: 'textScore' } };
        // Relevance first when the caller didn't ask for a specific ordering.
        if (filter.$text && sort === '-createdAt') sortValue = { score: { $meta: 'textScore' } };
      }
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

    const query = Product.find(filter, projection)
      .select('-sensitiveData')
      .sort(sortValue)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('sellerId', 'username trustLevel sellerStats');

    const [products, total] = await Promise.all([query, Product.countDocuments(filter)]);

    res.json({
      products: products.map(serializeProduct),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('[Products] list failed:', error);
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

router.get('/categories', async (_req: Request, res: Response) => {
  try {
    // Returns counts too, so the web filter can show "Instagram (24)" without a second call.
    const rows = await Product.aggregate([
      { $match: { status: 'active', listingType: 'public' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      categories: rows.map((r: any) => r._id),
      counts: rows.map((r: any) => ({ category: r._id, count: r.count })),
    });
  } catch (error: any) {
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

/** Aggregate numbers for the marketing/landing page. */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [active, sold, sellers] = await Promise.all([
      Product.countDocuments({ status: 'active', listingType: 'public' }),
      Product.countDocuments({ status: 'sold' }),
      User.countDocuments({ role: 'seller' }),
    ]);
    res.json({ active, sold, sellers, commission: config.platformCommission });
  } catch (error: any) {
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

router.get('/:id', validateObjectId(), async (req: Request, res: Response) => {
  try {
    // Bumping the counter in the same round trip that fetches the document, rather than a
    // read followed by a write.
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, listingType: 'public', status: { $in: ['active', 'reserved', 'sold'] } },
      { $inc: { viewCount: 1 } },
      { new: true }
    )
      .select('-sensitiveData')
      .populate('sellerId', 'username trustLevel sellerStats createdAt');

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product: serializeProduct(product) });
  } catch (error: any) {
    res.status(500).json({ error: config.isProd ? 'Internal server error' : error.message });
  }
});

/**
 * Shapes a product for public consumption. Note the seller's telegramId is deliberately not
 * included — v1 published it on every catalog entry, which let anyone scrape the contact
 * details of every seller and take deals off-platform (exactly what the escrow model exists
 * to prevent), and doubled as a PII leak.
 */
function serializeProduct(product: any) {
  const seller = product.sellerId;
  const ratingCount = seller?.sellerStats?.ratingCount ?? 0;

  return {
    _id: product._id,
    listingCode: product.listingCode,
    title: product.title,
    description: product.description,
    price: product.price,
    category: product.category,
    subcategory: product.subcategory,
    tags: product.tags,
    images: product.images,
    attributes: product.attributes,
    viewCount: product.viewCount,
    status: product.status,
    createdAt: product.createdAt,
    seller: seller
      ? {
          username: seller.username,
          trustLevel: seller.trustLevel,
          sold: seller.sellerStats?.sold ?? 0,
          rating: ratingCount ? Math.round((seller.sellerStats.ratingSum / ratingCount) * 10) / 10 : null,
          ratingCount,
        }
      : null,
  };
}

export default router;
