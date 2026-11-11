/** Only a disposable local database; no Telegram, payment provider or production writes. */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';

async function main() {
  Object.assign(process.env, { NODE_ENV: 'test', BOT_TOKEN: '', ADMIN_CHAT_ID: '', JOBS_ENABLED: 'false', PAYMENT_PROVIDER: 'sms', ALLOW_SELF_PURCHASE: 'false', ENCRYPTION_KEY: '2'.repeat(64), SESSION_SECRET: 'marketplace-local-only', SITE_URL: 'https://web-three-eosin-46.vercel.app' });
  const { Product } = await import('../../../backend/src/models/Product');
  const { User } = await import('../../../backend/src/models/User');
  const { marketplace } = await import('../core');
  const { backfillListingCodes } = await import('../../../backend/src/services/listingCodes');
  const { createSellerWizard } = await import('../handlers/seller');
  const { sendCatalogPage, sendProductDetail, listingLookup } = await import('../handlers/catalog');
  const { decryptSecret } = await import('../../../backend/src/utils/crypto');
  const { signSession } = await import('../../../backend/src/utils/jwt');
  const { default: productsRouter } = await import('../../../backend/src/routes/products');
  const { default: meRouter } = await import('../../../backend/src/routes/me');
  const db = `marketplace_test_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27920/${db}`, { serverSelectionTimeoutMS: 3000 });
  await Promise.all([Product.init(), User.init()]);
  const app = express(); app.use(express.json()); app.use('/api/products', productsRouter); app.use('/api/me', meRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  let checks = 0;
  const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++; console.log('PASS:', label); };
  try {
    const seller = await marketplace.getOrCreateUser(800001, { from: { first_name: 'Test' } });
    const stranger = await marketplace.getOrCreateUser(800002, { from: { first_name: 'Other' } });
    const input = { sellerId: String(seller._id), title: 'Instagram test account', description: 'Description of a local fixture account only.', price: 250000, category: 'Instagram', login: 'fixture-login', password: 'fixture-password' };
    const concurrent = await Promise.all(Array.from({ length: 22 }, (_, i) => marketplace.createProduct({ ...input, title: `Fixture account ${i}` })));
    check(new Set(concurrent.map(p => p.listingCode)).size === 22, '22 concurrent creations have unique numeric IDs');
    check(concurrent.every(p => /^[1-9]\d{5}$/.test(p.listingCode!) && p.status === 'active'), 'confirmed listings publish directly');
    const draftId = new mongoose.Types.ObjectId().toString();
    const replay = await Promise.all([marketplace.createProduct({ ...input, productId: draftId }), marketplace.createProduct({ ...input, productId: draftId })]);
    check(String(replay[0]._id) === String(replay[1]._id) && await Product.countDocuments({ _id: draftId }) === 1, 'replayed publication does not duplicate a draft');
    const privateDeal = await marketplace.createDeal({ ...input });
    const legacy: any = concurrent[0].toObject(); delete legacy.listingCode; legacy._id = new mongoose.Types.ObjectId();
    await Product.collection.insertOne(legacy);
    await Promise.all([backfillListingCodes(), backfillListingCodes()]);
    const migrated = await Product.findById(legacy._id);
    check(Boolean(migrated?.listingCode) && migrated?.status === 'active', 'legacy backfill is safe under concurrent startup');
    const first = await marketplace.getActiveProducts(1, 10), second = await marketplace.getActiveProducts(2, 10);
    check(first.products.length === 10 && second.products.length === 10 && !first.products.some(p => second.products.some(q => String(q._id) === String(p._id))), 'catalog pages contain ten distinct listings');
    check(!first.products.some(p => String(p._id) === String(privateDeal._id)), 'private deal stays outside the public catalog');
    const replies: any[] = [], edits: any[] = [];
    const ctx: any = { reply: async (...args: any[]) => { replies.push(args); }, editMessageText: async (...args: any[]) => { edits.push(args); } };
    await sendCatalogPage(ctx, 1); await sendCatalogPage(ctx, 2, true);
    check(replies.length === 1 && edits.length === 1, 'pagination edits the original message rather than spamming ten messages');
    check(await sendProductDetail(ctx, concurrent[0].listingCode!), 'bare public ID opens details');
    check(!JSON.stringify(replies).includes('fixture-password'), 'public details never reveal credentials');
    check(!await sendProductDetail(ctx, privateDeal.listingCode!) && !await sendProductDetail(ctx, String(privateDeal._id)), 'private details are blocked by short and database IDs');
    ctx.message = { text: `/id ${concurrent[0].listingCode}` }; ctx.session = { __scenes: { current: 'seller_create' }, productData: { password: 'draft-secret' } };
    await listingLookup(ctx, async () => { throw new Error('Lookup unexpectedly fell through'); });
    check(!ctx.session.__scenes && !ctx.session.productData, 'explicit /id exits and clears an active form');
    const search = await fetch(`${origin}/api/products?search=${concurrent[0].listingCode}`).then(r => r.json()) as any;
    check(search.products?.length === 1 && search.products[0].listingCode === concurrent[0].listingCode && !search.products[0].sensitiveData, 'public API searches by ID and returns safe data');
    const privateSearch = await fetch(`${origin}/api/products?search=${privateDeal.listingCode}`).then(r => r.json()) as any;
    check(privateSearch.products?.length === 0, 'public API code search cannot expose a private deal');
    const fixture = concurrent[1];
    check(!await marketplace.cancelListing(String(fixture._id), String(stranger._id)), 'another seller cannot cancel a listing');
    await Product.updateOne({ _id: fixture._id }, { $set: { status: 'reserved' } });
    check(!await marketplace.cancelListing(String(fixture._id), String(seller._id)), 'reserved listing cannot be cancelled');
    await Product.updateOne({ _id: fixture._id }, { $set: { status: 'sold' } });
    check(!await marketplace.cancelListing(String(fixture._id), String(seller._id)), 'sold listing cannot be cancelled');
    const token = signSession({ sub: String(seller._id), tg: seller.telegramId, sid: 'local-test' }, 3600);
    const cancelled = await fetch(`${origin}/api/me/listings/${concurrent[2]._id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    check(cancelled.status === 200 && (await Product.findById(concurrent[2]._id))?.status === 'archived', 'web cancellation works for public listings');
    check(!await sendProductDetail(ctx, concurrent[2].listingCode!), 'cancelled IDs no longer open public details');
    // Execute real wizard steps against the disposable DB; UI output is captured in memory.
    const wizard = createSellerWizard(); let cursor = 0, left = false; const messages: string[] = [];
    const wctx: any = { from: { id: seller.telegramId }, session: {}, reply: async (text: string) => { messages.push(text); }, replyWithHTML: async (text: string) => { messages.push(text); }, deleteMessage: async () => {}, answerCbQuery: async () => {}, wizard: { next: () => { cursor++; } }, scene: { leave: async () => { left = true; } } };
    async function step(text?: string, callback?: string) { wctx.message = text == null ? undefined : { text }; wctx.callbackQuery = callback ? { data: callback } : undefined; await (wizard.steps[cursor] as any)(wctx); }
    await step(); await step('Wizard fixture account'); await step('This is a disposable test account description.'); await step('250000'); await step('Instagram'); await step('wizard-login'); await step('wizard-password'); await step('yo‘q'); await step(undefined, 'photos_skip');
    check(cursor === 9 && messages.at(-1)?.includes('16 xonali'), 'after account details and photos the wizard asks for a card');
    await step('123'); check(cursor === 9, 'invalid card does not advance');
    await step('8600 0000 0000 0000'); check(cursor === 10 && !JSON.stringify(wctx.session).includes('8600000000000000'), 'draft card is encrypted before session persistence');
    await step('Ali'); check(cursor === 10, 'single name is rejected');
    await step('Ali Valiyev'); check(cursor === 11 && messages.at(-1)?.includes('Ali Valiyev') && !messages.at(-1)?.includes('8600000000000000'), 'review shows holder and masked card');
    const wizardId = wctx.session.productData.productId;
    check(!await Product.findById(wizardId), 'nothing publishes before final confirmation');
    await step(undefined, 'seller_publish_confirm');
    const published = await Product.findById(wizardId); const updatedSeller = await User.findById(seller._id);
    check(left && published?.status === 'active' && Boolean(published.listingCode), 'confirmation publishes and ends the wizard');
    check(decryptSecret(updatedSeller!.payoutCard!.encrypted) === '8600000000000000' && updatedSeller!.payoutCard!.holder === 'Ali Valiyev', 'confirmed card and holder are saved for payout');
    check(Object.keys(wctx.session.productData).length === 0, 'publication clears credentials and card draft');
    console.log(`Marketplace regression: ${checks} checks passed.`);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (mongoose.connection.name === db && db.startsWith('marketplace_test_')) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
