'use client';

/**
 * Client-side calls into the cabinet API.
 *
 * Every one of them goes to this origin's `/api/me/*` proxy — never to the backend directly —
 * so the session token stays in an httpOnly cookie the browser attaches on its own. There is
 * deliberately no place here to pass a token, because there is no way for page code to hold one.
 */

export interface Policy {
  commission: number;
  minPayout: number;
  payoutFee: number;
  paymentWindowMinutes: number;
  autoReleaseHours: number;
  refundPolicy: string;
  refundTiers: { id: string; label: string; penaltyPercent: number; allowed: boolean }[];
  categories: string[];
  maxImages: number;
  supportUrl: string;
}

export interface Me {
  id: string;
  telegramId: number;
  username?: string;
  firstName?: string;
  role: 'buyer' | 'seller' | 'admin' | 'moderator';
  trustLevel: 'new' | 'verified' | 'trusted' | 'partner';
  language: 'uz' | 'ru';
  balance: number;
  totalEarned: number;
  totalSpent: number;
  sellerStats: { listed: number; sold: number; refunded: number; ratingSum: number; ratingCount: number };
  payoutCard: { masked: string; holder: string } | null;
  notificationSettings: { newOrder: boolean; paymentConfirm: boolean; refundUpdate: boolean; promo: boolean };
  rating: number | null;
}

export interface OrderSummary {
  id: string;
  status: 'holding' | 'released' | 'refunded' | 'partial_refunded' | 'disputed';
  statusLabel: string;
  title: string;
  image: string | null;
  amount: number;
  boughtAt: string;
  revealedAt: string | null;
  autoReleaseAt: string;
  rated: boolean;
  rating: number | null;
}

export interface PendingPayment {
  id: string;
  status: 'pending_payment' | 'expired';
  paymentAmount: number;
  paymentProvider: 'sms' | 'hamyon';
  paymentReview: boolean;
  title: string;
  uniqueAmount: number;
  createdAt: string;
  expireAt: string;
}

export interface RefundQuote {
  allowed: boolean;
  label: string;
  period: string;
  elapsedMinutes: number;
  penaltyPercent: number;
  penaltyAmount: number;
  refundToBuyer: number;
  sellerKeeps: number;
  platformKeeps: number;
  requiresArbitration: boolean;
  message: string;
}

export interface OrderDetail {
  id: string;
  status: OrderSummary['status'];
  statusLabel: string;
  amount: number;
  boughtAt: string;
  revealedAt: string | null;
  autoReleaseAt: string;
  refundDeadlineAt: string;
  rated: boolean;
  rating: number | null;
  refundReason: string | null;
  product: { id: string; title: string; description: string; images: string[] } | null;
}

export interface Credentials {
  login: string;
  password: string;
  recoveryCode?: string;
  additionalInfo?: string;
}

export interface Listing {
  id: string;
  listingCode?: string;
  title: string;
  price: number;
  category: string;
  status: string;
  listingType: 'public' | 'private';
  images: string[];
  viewCount: number;
  createdAt: string;
  moderationNote: string | null;
  dealCode: string | null;
  dealExpiresAt: string | null;
}

export interface Sale {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  amount: number;
  sellerPayout: number;
  commission: number;
  boughtAt: string;
  revealedAt: string | null;
  autoReleaseAt: string;
  rating: number | null;
}

export interface Wallet {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  minPayout: number;
  payoutFee: number;
  card: { masked: string; holder: string } | null;
  entries: { id: string; amount: number; type: string; label: string; createdAt: string }[];
  payouts: {
    id: string;
    amount: number;
    netAmount: number;
    status: string;
    destinationMasked: string;
    requestedAt: string;
    processedAt: string | null;
  }[];
}

export interface PaymentInstructions {
  transactionId: string;
  product: { id: string; title: string; price: number };
  uniqueAmount: number;
  expiresAt: string;
  card: { number: string; masked: string; holder: string; bank: string } | null;
  paymentWindowMinutes: number;
}

/** Carries the HTTP status so callers can tell "not signed in" from "already settled". */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/me/${path}`, {
      ...init,
      // Same-origin by default, stated explicitly because the whole auth model depends on it.
      credentials: 'same-origin',
      signal: init.signal || AbortSignal.timeout(30000),
      headers: init.body && !(init.headers as any)?.['Content-Type']
        ? { 'Content-Type': 'application/json', ...(init.headers || {}) }
        : init.headers,
    });
  } catch {
    throw new ApiError('Server bilan aloqa uzildi. Amal bajarilgan bo‘lishi mumkin — qayta yuborishdan oldin holatni tekshiring.', 0);
  }

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Gateways and rate limiters can answer with plain text or HTML. Say what happened instead of
    // a parser error.
    throw new ApiError(
      response.status === 413
        ? 'Fayl juda katta, kichikroq rasm tanlang'
        : response.status === 429
          ? 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring'
          : response.status >= 500
            ? 'Server vaqtincha ishlamayapti. Birozdan so‘ng qayta urinib ko‘ring'
            : 'Server javobini o‘qib bo‘lmadi',
      response.status
    );
  }

  if (response.status === 401) {
    // The session expired or was revoked (including "log out everywhere" from another
    // device). Send them through the pairing flow and bring them back to this exact page.
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/kirish')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/kirish?next=${next}`;
    }
    throw new ApiError(data?.error || 'Sessiya tugadi — qaytadan kiring', 401);
  }

  if (!response.ok) {
    throw new ApiError(data?.error || 'Xatolik yuz berdi', response.status);
  }
  return data as T;
}

const post = <T,>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  profile: () => call<{ user: Me; policy: Policy }>('profile'),
  updateSettings: (patch: Record<string, unknown>) =>
    call<{ user: Me }>('settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  orders: () => call<{ orders: OrderSummary[]; pending: PendingPayment[] }>('orders'),
  order: (id: string) =>
    call<{ order: OrderDetail; refundQuote: RefundQuote | null; refundPolicy: string }>(`orders/${id}`),
  reveal: (id: string) =>
    post<{ credentials: Credentials; firstReveal: boolean; autoReleaseAt: string; refundPolicy: string }>(
      `orders/${id}/reveal`
    ),
  confirm: (id: string) => post<{ released: boolean; sellerPayout: number; commission: number }>(`orders/${id}/confirm`),
  refundQuote: (id: string) => call<{ quote: RefundQuote }>(`orders/${id}/refund-quote`),
  refund: (id: string, reasonType: string) =>
    post<{ refunded: boolean; refundToBuyer: number; penaltyAmount: number; period: string }>(`orders/${id}/refund`, {
      reasonType,
    }),
  rate: (id: string, rating: number) => post<{ ok: boolean }>(`orders/${id}/rate`, { rating }),

  buy: (productId: string, code?: string) =>
    post<PaymentInstructions>('purchases', code ? { productId, code } : { productId }),
  transactionStatus: (id: string) =>
    call<{
      paymentProvider?: 'sms' | 'hamyon';
      paymentAmount?: number;
      basePrice?: number;
      productId?: string;
      paymentReview?: boolean;
      status: 'pending_payment' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'completed';
      title: string;
      uniqueAmount: number;
      expireAt: string;
      orderId: string | null;
      card: { number: string; masked: string; holder: string; bank: string } | null;
    }>(`transactions/${id}/status`),
  lookupDeal: (code: string) =>
    post<{
      deal: {
        id: string;
        title: string;
        price: number;
        images: string[];
        isOwnDeal: boolean;
        seller: { username?: string; trustLevel: string; sold: number; rating: number | null; ratingCount: number } | null;
      };
      refundPolicy: string;
    }>('deals/lookup', { code }),

  listings: () => call<{ listings: Listing[] }>('listings'),
  sales: () => call<{ sales: Sale[] }>('sales'),
  createListing: (payload: Record<string, unknown>) => post<{ id: string; listingCode: string; status: string }>('listings', payload),
  createDeal: (payload: Record<string, unknown>) =>
    post<{
      id: string;
      title: string;
      price: number;
      sellerPayout: number;
      commission: number;
      dealCode: string;
      expiresAt: string;
      shareText: string;
    }>('deals', payload),
  cancelListing: (id: string) => post<{ ok: boolean }>(`listings/${id}/cancel`),

  wallet: () => call<Wallet>('wallet'),
  savePayoutCard: (cardNumber: string, holder: string) =>
    post<{ card: { masked: string; holder: string } }>('payout-card', { cardNumber, holder }),
  requestPayout: (amount: number) =>
    post<{ id: string; amount: number; netAmount: number; destinationMasked: string; status: string }>('payouts', {
      amount,
    }),

  uploadImage: async (file: File): Promise<string> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError('Internet aloqasi yo‘q, ulanishni tekshirib qayta urining', 0);
    }
    const data = await call<{ url: string }>('uploads', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type },
      // A cold-starting API plus a slow mobile uplink needs far more than the 30 s default.
      signal: AbortSignal.timeout(90_000),
    });
    return data.url;
  },
};

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Sessiyalarni bekor qilib bo‘lmadi');
}
