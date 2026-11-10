import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// Env first (dotenv never overrides it), so a developer's local .env cannot affect the test.
Object.assign(process.env, { NODE_ENV: 'test', PAYMENT_PROVIDER: 'sms', HAMYON_SHOP_ID: '219', HAMYON_SHOP_KEY: 'unit_test_key' });
// config validates PAYMENT_PROVIDER at import time, so load the module only after the env is set.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HamyonClient, HamyonError, hamyonSignature, verifyHamyonSignature } = require('./hamyonClient') as typeof import('./hamyonClient');

const KEY = 'unit_test_key';
const opts = { baseUrl: 'https://hamyon.test', shopId: '219', shopKey: KEY, windowSeconds: 300, maxAmountOffset: 30 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('signature is md5(shop_id + payment_id + amount + shop_key) in that exact order', () => {
  const expected = crypto.createHash('md5').update('219' + 'a1b2c3d4e5f6' + '50000' + KEY).digest('hex');
  assert.equal(hamyonSignature('219', 'a1b2c3d4e5f6', '50000', KEY), expected);
  assert.notEqual(hamyonSignature('219', '50000', 'a1b2c3d4e5f6', KEY), expected);
});

test('verification accepts a valid sign and rejects tampering, bad format and a missing key', () => {
  const sign = hamyonSignature('219', 'p1', '50000', KEY);
  const cb = { shop_id: '219', payment_id: 'p1', amount: '50000', sign };
  assert.equal(verifyHamyonSignature(cb, KEY), true);
  assert.equal(verifyHamyonSignature({ ...cb, sign: sign.toUpperCase() }, KEY), true);
  assert.equal(verifyHamyonSignature({ ...cb, amount: '50001' }, KEY), false);
  assert.equal(verifyHamyonSignature({ ...cb, payment_id: 'p2' }, KEY), false);
  assert.equal(verifyHamyonSignature({ ...cb, sign: 'abc' }, KEY), false);
  assert.equal(verifyHamyonSignature({ ...cb, sign: 'z'.repeat(32) }, KEY), false);
  assert.equal(verifyHamyonSignature(cb, ''), false);
});

test('createPayment posts form-encoded credentials and parses the documented response', async () => {
  let seen: { url: string; body: URLSearchParams; type: string } | undefined;
  const client = new HamyonClient(opts, (async (url: any, init: any) => {
    seen = { url: String(url), body: init.body, type: init.headers['Content-Type'] };
    return json({ payment_id: 'abc123', order_id: 'o1', amount: 50001, card: '8600123456789012', expires_in: 300, expire_at: 1767225600, message: 'ok' });
  }) as any);
  const res = await client.createPayment('o1', 50001);
  assert.equal(seen!.url, 'https://hamyon.test/payment/create');
  assert.equal(seen!.type, 'application/x-www-form-urlencoded');
  assert.equal(seen!.body.get('shop_id'), '219');
  assert.equal(seen!.body.get('amount'), '50001');
  assert.equal(seen!.body.get('order_id'), 'o1');
  assert.equal(res.payment_id, 'abc123');
  assert.equal(res.card, '8600123456789012');
  assert.equal(res.expire_at, 1767225600);
});

test('createPayment classifies failures and never leaks the secret key', async () => {
  const run = (impl: () => Promise<Response>) => new HamyonClient(opts, impl as any).createPayment('o1', 50000);
  await assert.rejects(run(async () => json({ error: 'amount busy' }, 400)), (e: any) => e instanceof HamyonError && e.kind === 'rejected');
  await assert.rejects(run(async () => json({ error: 'amount busy' })), (e: any) => e.kind === 'rejected');
  await assert.rejects(run(async () => json({}, 502)), (e: any) => e.kind === 'network');
  await assert.rejects(run(async () => { throw new Error('socket hang up ' + KEY); }), (e: any) => e.kind === 'network' && !e.message.includes(KEY));
  await assert.rejects(run(async () => json({ nonsense: true })), (e: any) => e.kind === 'invalid_response');
  await assert.rejects(run(async () => json({ payment_id: 'x', amount: 49999, card: '8600123456789012' })), (e: any) => e.kind === 'invalid_response');
  await assert.rejects(run(async () => json({ payment_id: 'x', order_id: 'other', amount: 50000, card: '8600123456789012' })), (e: any) => e.kind === 'invalid_response');
  await assert.rejects(new HamyonClient({ ...opts, shopKey: '' }, (async () => json({})) as any).createPayment('o1', 50000), (e: any) => e.kind === 'not_configured');
  for (const bad of [0, -5, 1.5, NaN]) await assert.rejects(new HamyonClient(opts, (async () => json({})) as any).createPayment('o1', bad), (e: any) => e.kind === 'rejected');
});
