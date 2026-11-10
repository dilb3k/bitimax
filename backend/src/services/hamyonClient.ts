import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../config';

/**
 * HamyonAPI (https://hamyon-api.uz) — card-transfer detection for HUMO / UZCARD.
 * Only what the official docs specify is used: POST /payment/create (form-encoded) and the
 * prepare/complete callbacks signed with md5(shop_id + payment_id + amount + shop_key).
 */

export type HamyonFailure = 'rejected' | 'network' | 'invalid_response' | 'not_configured';
export class HamyonError extends Error {
  constructor(public kind: HamyonFailure, message: string) {
    super(message);
    this.name = 'HamyonError';
  }
}

const createdSchema = z.object({
  payment_id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(100)),
  order_id: z.union([z.string(), z.number()]).transform(String).optional(),
  amount: z.coerce.number().int().positive(),
  card: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{12,19}$/)),
  expires_in: z.coerce.number().int().positive().optional(),
  expire_at: z.coerce.number().int().positive().optional(),
});
export type HamyonCreated = z.infer<typeof createdSchema>;

export interface HamyonCallback {
  payment_id: string; order_id: string; shop_id: string; amount: string; status: string;
  sign: string; paid_at?: string; reason?: string;
}

/** md5(shop_id + payment_id + amount + shop_key), built from the values exactly as received. */
export function hamyonSignature(shopId: string, paymentId: string, amount: string, shopKey: string): string {
  return crypto.createHash('md5').update(shopId + paymentId + amount + shopKey).digest('hex');
}

export function verifyHamyonSignature(
  cb: Pick<HamyonCallback, 'shop_id' | 'payment_id' | 'amount' | 'sign'>,
  shopKey = config.hamyon.shopKey,
): boolean {
  if (!shopKey || typeof cb.sign !== 'string' || !/^[a-fA-F0-9]{32}$/.test(cb.sign)) return false;
  const expected = Buffer.from(hamyonSignature(cb.shop_id, cb.payment_id, cb.amount, shopKey), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(cb.sign.toLowerCase(), 'hex'));
}

export class HamyonClient {
  constructor(
    private options = config.hamyon,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async createPayment(orderId: string, amount: number): Promise<HamyonCreated> {
    if (!this.options.shopKey || !this.options.shopId) throw new HamyonError('not_configured', 'HamyonAPI credentials missing');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HamyonError('rejected', 'Invalid payment amount');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/payment/create`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          shop_id: this.options.shopId, shop_key: this.options.shopKey,
          amount: String(amount), order_id: orderId,
        }),
      });
    } catch {
      // Timeout / DNS / TLS. The payment may or may not exist remotely.
      throw new HamyonError('network', 'HamyonAPI is unreachable');
    }
    let json: any;
    try { json = await response.json(); } catch { json = null; }
    if (!response.ok || (json && typeof json === 'object' && 'error' in json && !('payment_id' in json))) {
      if (response.status >= 500) throw new HamyonError('network', `HamyonAPI HTTP ${response.status}`);
      throw new HamyonError('rejected', `HamyonAPI rejected the payment (HTTP ${response.status})`);
    }
    const parsed = createdSchema.safeParse(json);
    if (!parsed.success) throw new HamyonError('invalid_response', 'Unexpected HamyonAPI response');
    const data = parsed.data;
    if (data.amount !== amount || (data.order_id !== undefined && data.order_id !== orderId)) {
      throw new HamyonError('invalid_response', 'HamyonAPI response does not match the request');
    }
    return data;
  }
}
export const hamyonClient = new HamyonClient();
