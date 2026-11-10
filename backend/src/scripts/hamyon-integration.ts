// Local only: mock HamyonAPI provider + isolated Mongo replica set (127.0.0.1:27919, set "tezchecktest").
// Never contacts the real provider and never moves money.
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';

const KEY = 'integration_fixture_key';
const MOCK_PORT = 4920;

async function main() {
  Object.assign(process.env, { NODE_ENV: 'test', PAYMENT_PROVIDER: 'hamyon', HAMYON_SHOP_ID: '219', HAMYON_SHOP_KEY: KEY,
    HAMYON_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, BOT_TOKEN: '', ADMIN_CHAT_ID: '', ALLOW_SELF_PURCHASE: 'false', JOBS_ENABLED: 'false' });
  const { paymentService, PaymentAllocationError } = await import('../services/paymentService');
  const { hamyonSignature } = await import('../services/hamyonClient');
  const { hamyonWebhook } = await import('../routes/hamyonWebhook');
  const { Transaction } = await import('../models/Transaction');
  const { Product } = await import('../models/Product');
  const { User } = await import('../models/User');
  const { EscrowHold } = await import('../models/EscrowHold');
  const { LedgerEntry } = await import('../models/LedgerEntry');
  const { expirePendingTransactions } = await import('../jobs/scheduler');

  // ── mock provider ──
  const mock = { open: new Map<string, string>(), mode: 'ok' as 'ok' | 'down' | 'garbage', created: 0, seq: 0 };
  const provider = express(); provider.use(express.urlencoded({ extended: false }));
  provider.post('/payment/create', (req, res) => {
    assert.equal(req.body.shop_key, KEY); assert.equal(req.body.shop_id, '219');
    if (mock.mode === 'down') return res.status(503).json({ error: 'down' });
    if (mock.mode === 'garbage') return res.json({ hello: 'world' });
    if (mock.open.has(req.body.amount)) return res.status(400).json({ error: 'Bu summada ochiq to‘lov bor' });
    const payment_id = `pay${++mock.seq}`; mock.created++;
    mock.open.set(req.body.amount, payment_id);
    res.json({ payment_id, order_id: req.body.order_id, amount: Number(req.body.amount), card: '8600123456789012',
      expires_in: 300, expire_at: Math.floor(Date.now() / 1000) + 300, message: 'ok' });
  });
  const providerServer = provider.listen(MOCK_PORT, '127.0.0.1');

  await mongoose.connect(`mongodb://127.0.0.1:27919/hamyon_test_${Date.now()}?replicaSet=tezchecktest`);
  await Promise.all([Transaction.init(), Product.init(), User.init(), EscrowHold.init(), LedgerEntry.init()]);
  const app = express(); app.use(hamyonWebhook);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const seller = await User.create({ telegramId: 201 });
  const buyer = await User.create({ telegramId: 202 });
  const other = await User.create({ telegramId: 203 });
  const post = (kind: string, fields: Record<string, string>, json = false) => fetch(`${base}/api/payments/hamyon/${kind}`, {
    method: 'POST', headers: { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: json ? JSON.stringify(fields) : new URLSearchParams(fields),
  });
  const cb = (t: any, status: string, over: Record<string, string> = {}) => {
    const f = { payment_id: t.hamyonPaymentId, order_id: String(t._id), shop_id: '219', amount: String(t.hamyonAmount), status, ...over };
    return { ...f, sign: over.sign ?? hamyonSignature(f.shop_id, f.payment_id, f.amount, KEY) };
  };
  const newProduct = (price = 150000) => Product.create({ sellerId: seller._id, title: 'Sinov akkaunt', description: 'fixture',
    price, category: 'Boshqa', status: 'active', sensitiveData: { login: 'test', password: 'test' } });
  const order = async (price = 150000, who = buyer) => {
    const product = await newProduct(price);
    const r = await paymentService.createPaymentTransaction(String(product._id), String(who._id));
    return { product, r, t: (await Transaction.findById(r.transaction._id))! };
  };
  const holds = (t: any) => EscrowHold.countDocuments({ transactionId: t._id });
  const ledger = (t: any) => LedgerEntry.countDocuments({ key: `payment:${t._id}` });

  try {
    // 1. successful creation; accounting stays at the price, buyer sees the provider's exact amount
    const a = await order();
    assert.equal(a.r.paymentProvider, 'hamyon');
    assert.equal(a.t.basePrice, 150000);
    assert.equal(a.t.hamyonAmount, 150000);
    assert.equal(a.t.hamyonPaymentId, 'pay1');
    assert.equal(a.t.hamyonOrderId, String(a.t._id));
    assert.equal(a.r.card?.raw, '8600123456789012');
    assert.equal(a.r.uniqueAmount, 150000);
    assert.ok(a.t.expireAt.getTime() - Date.now() <= 300_000 && a.t.expireAt.getTime() > Date.now());
    // re-opening the same product returns the same open payment, not a second one
    const again = await paymentService.createPaymentTransaction(String(a.product._id), String(buyer._id));
    assert.equal(String(again.transaction._id), String(a.t._id));
    assert.equal(mock.created, 1);

    // 13. same-amount collision: second order gets +1 so'm, price/accounting untouched
    const b = await order(150000, other);
    assert.equal(b.t.hamyonAmount, 150001);
    assert.equal(b.t.basePrice, 150000);
    assert.equal(b.r.uniqueAmount, 150001);
    assert.ok(await Transaction.exists({ _id: b.t._id, uniqueAmount: 150001 }));

    // 2. failed creation: provider down / invalid response -> reservation released, nothing stays pending
    for (const mode of ['down', 'garbage'] as const) {
      mock.mode = mode;
      const p = await newProduct(90000);
      await assert.rejects(paymentService.createPaymentTransaction(String(p._id), String(buyer._id)), PaymentAllocationError);
      assert.equal((await Product.findById(p._id))!.status, 'active');
      assert.equal(await Transaction.countDocuments({ productId: p._id, status: 'pending_payment' }), 0);
    }
    mock.mode = 'ok';

    // 14. unauthorized access is impossible through the buyer-scoped status query
    assert.equal(await Transaction.countDocuments({ _id: a.t._id, buyerId: other._id }), 0);

    // 3. prepare: records the start, never fulfils
    assert.equal((await post('prepare', cb(a.t, 'prepare'))).status, 200);
    let t = (await Transaction.findById(a.t._id))!;
    assert.ok(t.hamyonPreparedAt); assert.equal(t.status, 'pending_payment'); assert.equal(await holds(t), 0);
    assert.equal((await post('prepare', cb(a.t, 'paid'))).status, 400); // wrong status for prepare_url

    // 6-9. invalid signature / amount / order id / shop id / unknown payment — all rejected, nothing fulfilled
    assert.equal((await post('complete', cb(a.t, 'paid', { sign: '0'.repeat(32) }))).status, 400);
    assert.equal((await post('complete', cb(a.t, 'paid', { sign: 'nothex' }))).status, 400);
    assert.equal((await post('complete', cb(a.t, 'paid', { amount: '1' }))).status, 400);       // signed, wrong amount
    assert.equal((await post('complete', cb(a.t, 'paid', { order_id: String(b.t._id) }))).status, 400);
    assert.equal((await post('complete', cb(a.t, 'paid', { shop_id: '999' }))).status, 400);
    assert.equal((await post('complete', cb(a.t, 'paid', { payment_id: 'nope', order_id: new mongoose.Types.ObjectId().toString() }))).status, 404);
    assert.equal((await post('complete', cb(a.t, 'weird'))).status, 400);
    assert.equal((await post('complete', { payment_id: 'x' })).status, 400);
    t = (await Transaction.findById(a.t._id))!;
    assert.equal(t.status, 'pending_payment'); assert.equal(await holds(t), 0);

    // 4/10/11/15. valid paid callback (JSON also accepted), then duplicates and a concurrent burst: exactly one escrow + ledger
    assert.equal((await post('complete', { ...cb(a.t, 'paid', { paid_at: '2026-01-01 10:00:00' }) }, true)).status, 200);
    const burst = await Promise.all(Array.from({ length: 8 }, () => post('complete', cb(a.t, 'paid'))));
    assert.ok(burst.every(r => r.status === 200));
    t = (await Transaction.findById(a.t._id))!;
    assert.equal(t.status, 'paid');
    assert.equal(await holds(t), 1); assert.equal(await ledger(t), 1);
    assert.equal((await Product.findById(a.product._id))!.status, 'sold');
    assert.equal((await User.findById(buyer._id))!.buyerStats.purchased, 1);
    // a stale cancel can never undo a paid payment
    assert.equal((await post('complete', cb(a.t, 'cancel', { reason: 'timeout' }))).status, 200);
    assert.equal((await Transaction.findById(a.t._id))!.status, 'paid');

    // concurrent first-time burst on a fresh order (no sequential head start)
    const c = await order(70000);
    const race = await Promise.all(Array.from({ length: 10 }, () => post('complete', cb(c.t, 'paid'))));
    assert.ok(race.every(r => r.status === 200));
    assert.equal(await holds(c.t), 1); assert.equal(await ledger(c.t), 1);

    // 5/12. cancel callback expires the order and frees the product; late "paid" afterwards needs review, not fulfilment
    assert.equal((await post('complete', cb(b.t, 'cancel', { reason: 'timeout' }))).status, 200);
    assert.equal((await post('complete', cb(b.t, 'cancel', { reason: 'timeout' }))).status, 200);
    t = (await Transaction.findById(b.t._id))!;
    assert.equal(t.status, 'expired'); assert.equal(t.hamyonCancelReason, 'timeout');
    assert.equal((await Product.findById(b.product._id))!.status, 'active');
    assert.equal((await post('complete', cb(b.t, 'paid'))).status, 200);
    t = (await Transaction.findById(b.t._id))!;
    assert.equal(t.status, 'expired'); assert.equal(t.paymentReview, 'paid_after_expired'); assert.equal(await holds(t), 0);

    // 12b. a buyer can start a new payment after expiry (amount freed again by the provider mock)
    mock.open.clear();
    const retry = await paymentService.createPaymentTransaction(String(b.product._id), String(other._id));
    assert.equal(retry.transaction.status, 'pending_payment');
    assert.notEqual(String(retry.transaction._id), String(b.t._id));

    // 12c. scheduler backstop: hamyon waits for the grace period, then expires
    const d = await order(60000);
    await Transaction.updateOne({ _id: d.t._id }, { $set: { expireAt: new Date(Date.now() - 30_000) } });
    await expirePendingTransactions();
    assert.equal((await Transaction.findById(d.t._id))!.status, 'pending_payment');
    await Transaction.updateOne({ _id: d.t._id }, { $set: { expireAt: new Date(Date.now() - 200_000) } });
    await expirePendingTransactions();
    assert.equal((await Transaction.findById(d.t._id))!.status, 'expired');
    assert.equal((await Product.findById(d.product._id))!.status, 'active');

    // callback arriving before the create response was stored is adopted via order_id (signature-proven)
    const e = await order(55000);
    await Transaction.updateOne({ _id: e.t._id }, { $unset: { hamyonPaymentId: '' } });
    const ghost = (await Transaction.findById(e.t._id))!;
    const f = { payment_id: 'pay_adopt', order_id: String(ghost._id), shop_id: '219', amount: String(ghost.hamyonAmount), status: 'paid' };
    assert.equal((await post('complete', { ...f, sign: hamyonSignature('219', f.payment_id, f.amount, KEY) })).status, 200);
    t = (await Transaction.findById(e.t._id))!;
    assert.equal(t.status, 'paid'); assert.equal(t.hamyonPaymentId, 'pay_adopt');

    // lost reservation: money arrived but the product is gone -> no escrow, operator review
    const g = await order(65000);
    await Product.updateOne({ _id: g.product._id }, { $set: { status: 'active' }, $unset: { reservedBy: '' } });
    assert.equal((await post('complete', cb(g.t, 'paid'))).status, 200);
    t = (await Transaction.findById(g.t._id))!;
    assert.equal(t.paymentReview, 'paid_but_reservation_lost'); assert.equal(await holds(t), 0);

    // the secret never appears in stored rows
    const dump = JSON.stringify(await Transaction.find().lean());
    assert.ok(!dump.includes(KEY));
    console.log('HamyonAPI integration: all checks passed');
  } finally {
    server.close(); providerServer.close();
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
