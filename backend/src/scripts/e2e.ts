/**
 * End-to-end walkthrough of the whole platform, run against a real MongoDB.
 *
 * Unit tests cover the arithmetic; this covers the parts that only break when real documents,
 * real sessions and real concurrency are involved — reservations, atomic claims, the ledger
 * staying balanced across every settlement path, and the sweepers.
 *
 * Run with:  npm run e2e
 * MONGODB_URI must point at a throwaway database. The guard below refuses to touch anything
 * whose name isn't explicitly a test database, because this script wipes collections.
 */
import mongoose from 'mongoose';
import { decryptSecret } from '../utils/crypto';
import { config } from '../config';
import { connectDatabase } from '../db/mongoose';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { Transaction } from '../models/Transaction';
import { EscrowHold } from '../models/EscrowHold';
import { LedgerEntry } from '../models/LedgerEntry';
import { PaymentInbox } from '../models/PaymentInbox';
import { Payout } from '../models/Payout';
import { marketplace } from '../services/marketplaceService';
import {
  paymentService,
  ProductUnavailableError,
  AlreadyProcessedError,
  ForbiddenError,
} from '../services/paymentService';
import { payoutService, InsufficientBalanceError } from '../services/payoutService';
import { ledgerService, accounts } from '../services/ledgerService';
import { quoteRefund } from '../services/refundEngine';
import {
  expirePendingTransactions,
  settleDueEscrows,
  expireUnclaimedDeals,
} from '../jobs/scheduler';
import { formatUzs, formatDealCode } from '../utils/helpers';

// ─── tiny harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, actual === expected, `kutilgan ${expected}, olindi ${actual}`);
}

function section(title: string) {
  console.log(`\n\x1b[1m▶ ${title}\x1b[0m`);
}

async function expectThrow(label: string, fn: () => Promise<unknown>, type?: Function) {
  try {
    await fn();
    check(label, false, 'xato kutilgan edi, lekin muvaffaqiyatli tugadi');
  } catch (err) {
    check(label, type ? err instanceof type : true, type ? `boshqa xato: ${(err as Error).name}` : '');
  }
}

/** Ledger invariant: every account balance summed together must be exactly zero. */
async function assertLedgerBalanced(label: string) {
  const balances = await ledgerService.allBalances();
  const total = Object.values(balances).reduce((sum, v) => sum + v, 0);
  check(`${label} — ledger balanslangan`, total === 0, `jami ${total}`);
}

async function balanceOf(userId: string) {
  return ledgerService.balanceOf(accounts.userAvailable(userId));
}

// ─── helpers that stand in for a person pressing buttons ───────────────────────

async function makeUser(telegramId: number, username: string, role: 'buyer' | 'seller' | 'admin') {
  return User.create({
    telegramId,
    username,
    firstName: username,
    role,
    referralCode: `ref${telegramId}`,
    trustLevel: 'trusted', // so price ceilings don't get in the way of the scenarios
  });
}

/** Simulates the bank SMS the gateway forwards after a buyer transfers. */
async function payFor(uniqueAmount: number, note = 'e2e') {
  const text = `Hisobingizga ${uniqueAmount} so'm tushdi. ${note}`;
  const receivedAt = Date.now();
  const result = await paymentService.confirmPaymentBySms(text, 'TEST-BANK', receivedAt);
  // Returned so a test can replay the identical delivery and prove dedupe works.
  return { ...result, text, receivedAt };
}

/** Rewinds an escrow's clock so refund tiers can be exercised without waiting hours. */
async function rewindReveal(escrowId: string, minutesAgo: number) {
  const revealedAt = new Date(Date.now() - minutesAgo * 60_000);
  await EscrowHold.updateOne({ _id: escrowId }, { $set: { credentialsRevealedAt: revealedAt } });
}

// ─── scenarios ─────────────────────────────────────────────────────────────────

async function scenarioPublicSale() {
  section('1. Bozor oqimi — sotuvchi e’lon qo‘yadi, xaridor sotib oladi');

  const seller = await makeUser(9001, 'seller_ali', 'seller');
  const buyer = await makeUser(9002, 'buyer_vali', 'buyer');

  const product = await marketplace.createProduct({
    sellerId: String(seller._id),
    title: 'Instagram 12k obunachi',
    description: 'O‘zbekistonlik auditoriya, 2019-yildan beri faol, ban tarixi yo‘q.',
    price: 1_000_000,
    category: 'Instagram',
    login: 'insta_login@mail.uz',
    password: 'SuperSecret123',
    recoveryCode: 'REC-42',
  });

  // Sellers confirm the listing themselves; it goes live directly (no moderation queue).
  eq('tasdiqlangan e’lon darhol faol bo‘ladi', product.status, 'active');
  eq('e’lon katalogda ko‘rinadi', await Product.countDocuments({ status: 'active', listingType: 'public' }), 1);
  const catalog = await marketplace.getActiveProducts(1, 10);
  eq('tasdiqlangach katalogda ko‘rinadi', catalog.total, 1);

  // Credentials must never be readable from a serialized product.
  const serialized = JSON.parse(JSON.stringify(catalog.products[0]));
  check('katalog javobida parol yo‘q', serialized.sensitiveData === undefined);

  // Stored form must be ciphertext, not the password.
  const raw = await Product.collection.findOne({ _id: product._id as any });
  check(
    'parol bazada shifrlangan',
    typeof raw?.sensitiveData?.password === 'string' &&
      raw.sensitiveData.password.startsWith('v1:') &&
      !raw.sensitiveData.password.includes('SuperSecret')
  );

  // Buyer starts a purchase.
  const purchase = await marketplace.initiatePurchase(String(product._id), String(buyer._id));
  check('to‘lov summasi narxdan katta (unikal quyruq)', purchase.uniqueAmount > 1_000_000);
  check('quyruq 1000 so‘mdan kichik', purchase.uniqueAmount - 1_000_000 < 1000);

  const reserved = await Product.findById(product._id);
  eq('mahsulot band qilindi', reserved!.status, 'reserved');

  // A second buyer must not be able to grab the same product.
  const buyer2 = await makeUser(9003, 'buyer_rustam', 'buyer');
  await expectThrow(
    'ikkinchi xaridor band mahsulotni ololmaydi',
    () => marketplace.initiatePurchase(String(product._id), String(buyer2._id)),
    ProductUnavailableError
  );

  // Seller can't buy their own listing — checked on a separate product so the purchase
  // already in flight above is left untouched.
  const ownProduct = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'O‘z mahsuloti',
    price: 50_000,
    login: 'own',
    password: 'own',
  });
  await expectThrow(
    'sotuvchi o‘z mahsulotini sotib ololmaydi',
    () => marketplace.initiatePurchase(String(ownProduct._id), String(seller._id), ownProduct.dealCode!),
    ForbiddenError
  );
  const releasedBack = await Product.findById(ownProduct._id);
  eq('rad etilgach mahsulot band bo‘lib qolmaydi', releasedBack!.status, 'active');

  return { seller, buyer, buyer2, product, purchase };
}

async function scenarioPayment(ctx: Awaited<ReturnType<typeof scenarioPublicSale>>) {
  section('2. To‘lov — bank SMS orqali avtomatik tasdiqlash');

  // Wrong amount must not confirm anything.
  const wrong = await payFor(ctx.purchase.uniqueAmount + 7, 'notogri');
  eq('noto‘g‘ri summa buyurtmani tasdiqlamaydi', wrong.matched, false);
  eq('mos kelmagan to‘lov inbox’ga tushadi', wrong.reason, 'no_match');
  const unmatched = await PaymentInbox.countDocuments({ status: 'unmatched' });
  eq('inbox’da 1 ta hal qilinmagan to‘lov', unmatched, 1);

  // A debit notification must never be treated as income.
  const debit = await paymentService.confirmPaymentBySms(
    `Hisobingizdan ${ctx.purchase.uniqueAmount} so'm yechildi`,
    'TEST-BANK',
    Date.now()
  );
  eq('chiqim SMS to‘lov deb hisoblanmaydi', debit.reason, 'outgoing');

  // The real payment.
  const paid = await payFor(ctx.purchase.uniqueAmount);
  eq('to‘g‘ri summa buyurtmani tasdiqlaydi', paid.matched, true);

  // Exact same SMS delivered twice must be a no-op.
  const dup = await paymentService.confirmPaymentBySms(paid.text, 'TEST-BANK', paid.receivedAt);
  check('takroriy SMS ikkinchi marta ishlov ko‘rmaydi', dup.matched === false);
  eq('takror deb belgilanadi', dup.reason, 'duplicate');

  // A malformed timestamp from the gateway must not block a real payment.
  const junkTime = await paymentService.confirmPaymentBySms(
    `Hisobingizga 12345 so'm tushdi. junk-time`,
    'TEST-BANK',
    'not-a-real-date'
  );
  check('noto‘g‘ri received_at to‘lovni buzmaydi', junkTime.reason === 'no_match');

  const escrow = await EscrowHold.findOne({ transactionId: paid.transaction._id });
  check('escrow yaratildi', Boolean(escrow));
  eq('escrow holati holding', escrow!.status, 'holding');
  eq('escrow summasi narxga teng', escrow!.amount, 1_000_000);
  eq('komissiya 7%', escrow!.commission, 70_000);
  eq('sotuvchi ulushi 93%', escrow!.sellerPayout, 930_000);

  const soldProduct = await Product.findById(ctx.product._id);
  eq('mahsulot sotilgan deb belgilandi', soldProduct!.status, 'sold');

  const escrowBalance = await ledgerService.balanceOf(accounts.escrow(String(escrow!._id)));
  eq('pul escrow hisobida turibdi', escrowBalance, 1_000_000);
  eq('sotuvchi balansi hali 0', await balanceOf(String(ctx.seller._id)), 0);
  await assertLedgerBalanced('to‘lovdan keyin');

  return escrow!;
}

async function scenarioRevealAndConfirm(
  ctx: Awaited<ReturnType<typeof scenarioPublicSale>>,
  escrow: any
) {
  section('3. Ochish va tasdiqlash — xaridor tomoni');

  const fresh = await EscrowHold.findById(escrow._id);
  check('ochilmagan buyurtmada qaytarish taymeri boshlanmagan', !fresh!.credentialsRevealedAt);

  // An unrevealed order is fully refundable no matter how much time passed.
  const quoteBefore = await paymentService.quoteRefundFor(String(escrow._id));
  eq('ochilmagan buyurtma 100% qaytariladi', quoteBefore.refundToBuyer, 1_000_000);

  // Somebody else must not be able to open it.
  await expectThrow(
    'begona xaridor ma’lumotni ocholmaydi',
    () => paymentService.revealCredentials(String(escrow._id), String(ctx.buyer2._id)),
    ForbiddenError
  );

  const revealed = await paymentService.revealCredentials(
    String(escrow._id),
    String(ctx.buyer._id)
  );
  eq('login to‘g‘ri deshifrlandi', revealed.credentials.login, 'insta_login@mail.uz');
  eq('parol to‘g‘ri deshifrlandi', revealed.credentials.password, 'SuperSecret123');
  eq('tiklash kodi to‘g‘ri deshifrlandi', revealed.credentials.recoveryCode, 'REC-42');
  check('birinchi ochilish belgilandi', revealed.firstReveal);

  const afterReveal = await EscrowHold.findById(escrow._id);
  check('qaytarish taymeri ochilgandan boshlandi', Boolean(afterReveal!.credentialsRevealedAt));
  check(
    'avtomatik yopilish 24 soatga surildi',
    afterReveal!.autoReleaseAt.getTime() > Date.now() + 23 * 3600_000
  );

  // Re-opening is allowed (buyer lost the message) but must not restart the clock.
  const again = await paymentService.revealCredentials(String(escrow._id), String(ctx.buyer._id));
  check('qayta ochish taymerni qaytadan boshlamaydi', !again.firstReveal);
  eq('ochilish soni hisoblanadi', again.hold.credentialRevealCount, 2);

  // Confirm → money moves.
  const result = await paymentService.confirmAndRelease(String(escrow._id), String(ctx.buyer._id));
  eq('sotuvchiga o‘tkazildi', result.sellerPayout, 930_000);

  eq('sotuvchi balansi 930 000', await balanceOf(String(ctx.seller._id)), 930_000);
  eq('platforma daromadi 70 000', await ledgerService.balanceOf(accounts.platformRevenue), 70_000);
  eq('escrow hisobi bo‘shadi', await ledgerService.balanceOf(accounts.escrow(String(escrow._id))), 0);
  await assertLedgerBalanced('tasdiqlashdan keyin');

  const sellerDoc = await User.findById(ctx.seller._id);
  eq('User.balance keshi ledger bilan bir xil', sellerDoc!.balance, 930_000);

  // Settling twice must be impossible.
  await expectThrow(
    'ikki marta tasdiqlab bo‘lmaydi',
    () => paymentService.confirmAndRelease(String(escrow._id), String(ctx.buyer._id)),
    AlreadyProcessedError
  );
}

async function scenarioPrivateDeal() {
  section('4. Kafil bitim — kod bilan, katalogsiz');

  const seller = await makeUser(9101, 'deal_seller', 'seller');
  const buyer = await makeUser(9102, 'deal_buyer', 'buyer');

  const deal = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'PUBG akkaunt — Conqueror',
    price: 500_000,
    login: 'pubg_user',
    password: 'PubgPass!99',
  });

  check('bitim kodi berildi', Boolean(deal.dealCode) && deal.dealCode!.length === 8);
  eq('kelishilgan bitim darhol faol (moderatsiyasiz)', deal.status, 'active');
  eq('turi yopiq', deal.listingType, 'private');
  console.log(`     kod: ${formatDealCode(deal.dealCode!)}`);

  // The whole point: it must be invisible to everyone without the code.
  const publicList = await marketplace.getActiveProducts(1, 50);
  const leaked = publicList.products.some((p: any) => String(p._id) === String(deal._id));
  check('yopiq bitim katalogda KO‘RINMAYDI', !leaked);

  const found = await marketplace.findDealByCode(deal.dealCode!);
  check('kod bo‘yicha topiladi', Boolean(found));
  check('kod kichik harf va tire bilan ham ishlaydi', Boolean(
    await marketplace.findDealByCode(formatDealCode(deal.dealCode!).toLowerCase())
  ));
  check('noto‘g‘ri kod hech narsa qaytarmaydi', (await marketplace.findDealByCode('AAAA2222')) === null);

  // The seller can edit an unsold listing; the edit is atomic and re-encrypts credentials.
  const edited = await marketplace.updateListing(String(deal._id), String(seller._id), {
    title: 'Yangilangan nom',
    description: 'Yangilangan tavsif, kamida yigirma belgi bo‘lishi kerak.',
    password: 'yangi-parol',
  });
  eq('tahrir: nom yangilandi', edited!.title, 'Yangilangan nom');
  eq('tahrir: parol qayta shifrlandi', decryptSecret(edited!.sensitiveData.password), 'yangi-parol');
  check('tahrir: login saqlanib qoldi', Boolean(decryptSecret(edited!.sensitiveData.login)));
  eq('tahrir: boshqa sotuvchi e’lonni o‘zgartira olmaydi', await marketplace.updateListing(String(deal._id), String(buyer._id), { title: 'Hujum' }), null);
  await expectThrow('tahrir: noto‘g‘ri narx rad etiladi', () => marketplace.updateListing(String(deal._id), String(seller._id), { price: 5 }));
  await expectThrow('tahrir: noto‘g‘ri kategoriya rad etiladi', () => marketplace.updateListing(String(deal._id), String(seller._id), { category: 'Hack' }));

  // The id alone must never open a private deal; only the code does.
  await expectThrow(
    'yopiq bitimni kodsiz (faqat ID bilan) band qilib bo‘lmaydi',
    () => marketplace.initiatePurchase(String(deal._id), String(buyer._id)),
    ProductUnavailableError
  );
  await expectThrow(
    'yopiq bitimni noto‘g‘ri kod bilan band qilib bo‘lmaydi',
    () => marketplace.initiatePurchase(String(deal._id), String(buyer._id), 'AAAA2222'),
    ProductUnavailableError
  );

  // Buyer redeems and pays.
  const purchase = await marketplace.initiatePurchase(String(deal._id), String(buyer._id), deal.dealCode!);
  eq('tahrir: band qilingan e’lonni o‘zgartirib bo‘lmaydi', await marketplace.updateListing(String(deal._id), String(seller._id), { title: 'Kech' }), null);
  const paid = await payFor(purchase.uniqueAmount, 'deal');
  eq('kafil bitim to‘lovi tasdiqlandi', paid.matched, true);

  const escrow = await EscrowHold.findOne({ transactionId: paid.transaction._id });
  eq('escrow summasi', escrow!.amount, 500_000);
  await assertLedgerBalanced('kafil bitim to‘lovidan keyin');

  return { seller, buyer, deal, escrow: escrow! };
}

async function scenarioRefunds(ctx: Awaited<ReturnType<typeof scenarioPrivateDeal>>) {
  section('5. Qaytarish — har bir davr uchun aniq summa');

  await paymentService.revealCredentials(String(ctx.escrow._id), String(ctx.buyer._id));

  // 45 minutes after reveal → the 10% tier.
  await rewindReveal(String(ctx.escrow._id), 45);
  const quote = await paymentService.quoteRefundFor(String(ctx.escrow._id));
  eq('davr aniqlandi', quote.period, '10min-2h');
  eq('xaridorga 90% (va’da qilingani)', quote.refundToBuyer, 450_000);
  eq('sotuvchiga jarimadan kompensatsiya', quote.sellerKeeps, 46_500);
  eq('platformaga jarimadan komissiya', quote.platformKeeps, 3_500);
  eq(
    'to‘rt ulush summaga teng',
    quote.refundToBuyer + quote.sellerKeeps + quote.platformKeeps,
    500_000
  );

  const platformBefore = await ledgerService.balanceOf(accounts.platformRevenue);
  const refund = await paymentService.processRefund(
    String(ctx.escrow._id),
    'Akkaunt ishlamayapti',
    String(ctx.buyer._id)
  );
  check('qaytarish ruxsat etildi', refund.allowed === true);

  eq('xaridor balansiga aynan 450 000', await balanceOf(String(ctx.buyer._id)), 450_000);
  eq('sotuvchi balansiga 46 500', await balanceOf(String(ctx.seller._id)), 46_500);
  eq(
    'platforma faqat jarimadan oldi',
    (await ledgerService.balanceOf(accounts.platformRevenue)) - platformBefore,
    3_500
  );
  await assertLedgerBalanced('qaytarishdan keyin');

  await expectThrow(
    'ikki marta qaytarib bo‘lmaydi',
    () => paymentService.processRefund(String(ctx.escrow._id), 'takror'),
    AlreadyProcessedError
  );

  // 24 hours+ → refused.
  const late = quoteRefund({
    amount: 500_000,
    boughtAt: new Date(Date.now() - 30 * 3600_000),
    revealedAt: new Date(Date.now() - 30 * 3600_000),
  });
  eq('24 soatdan keyin avtomatik qaytarish yo‘q', late.allowed, false);
}

async function scenarioRefundAbuse() {
  section('6. Qaytarishni suiiste’mol qilishga qarshi himoya');

  const seller = await makeUser(9201, 'abuse_seller', 'seller');
  const buyer = await makeUser(9202, 'abuse_buyer', 'buyer');

  for (let i = 0; i < config.refundAbuseThreshold; i++) {
    const deal = await marketplace.createDeal({
      sellerId: String(seller._id),
      title: `Akkaunt ${i}`,
      price: 100_000,
      login: `login${i}`,
      password: `pass${i}`,
    });
    const purchase = await marketplace.initiatePurchase(String(deal._id), String(buyer._id), deal.dealCode!);
    const paid = await payFor(purchase.uniqueAmount, `abuse${i}`);
    const escrow = await EscrowHold.findOne({ transactionId: paid.transaction._id });
    await paymentService.revealCredentials(String(escrow!._id), String(buyer._id));
    await paymentService.processRefund(String(escrow!._id), 'test', String(buyer._id));
  }

  const flagged = await User.findById(buyer._id);
  eq(
    `${config.refundAbuseThreshold} ta qaytarishdan keyin avtomatik qaytarish o‘chdi`,
    flagged!.refundAutoDisabled,
    true
  );
  eq('30 kunlik oyna hisoblandi', flagged!.buyerStats.refundsLast30d, config.refundAbuseThreshold);

  // Once flagged, the next buyer-initiated refund must be refused (a person decides).
  const extra = await marketplace.createDeal({
    sellerId: String(seller._id), title: 'Qo‘shimcha', price: 100_000, login: 'lx', password: 'px',
  });
  const extraBuy = await marketplace.initiatePurchase(String(extra._id), String(buyer._id), extra.dealCode!);
  const extraPaid = await payFor(extraBuy.uniqueAmount, 'abuse-extra');
  const extraEscrow = await EscrowHold.findOne({ transactionId: extraPaid.transaction._id });
  await paymentService.revealCredentials(String(extraEscrow!._id), String(buyer._id));
  const blocked = await paymentService.processRefund(String(extraEscrow!._id), 'test', String(buyer._id));
  eq('belgilangan xaridorga avtomatik qaytarish berilmaydi', blocked.allowed, false);
  eq('hold hali ham holding', (await EscrowHold.findById(extraEscrow!._id))!.status, 'holding');
  await assertLedgerBalanced('suiiste’mol stsenariysidan keyin');
}

async function scenarioPayout() {
  section('7. Pul yechish — balansdan kartaga');

  const seller = await User.findOne({ telegramId: 9001 });
  const balance = await balanceOf(String(seller!._id));
  check('sotuvchida yechish uchun mablag‘ bor', balance >= config.minPayoutAmount);

  await expectThrow('kartasiz yechib bo‘lmaydi', () =>
    payoutService.requestPayout(String(seller!._id), 100_000)
  );

  await payoutService.setPayoutCard(String(seller!._id), '8600123456789012', 'ALI VALIYEV');
  const withCard = await User.findById(seller!._id);
  eq('karta maskalangan holda saqlandi', withCard!.payoutCard!.masked, '8600 •••• •••• 9012');
  check(
    'karta raqami shifrlangan',
    withCard!.payoutCard!.encrypted.startsWith('v1:') &&
      !withCard!.payoutCard!.encrypted.includes('8600123456789012')
  );

  await expectThrow(
    'balansdan ortiq yechib bo‘lmaydi',
    () => payoutService.requestPayout(String(seller!._id), balance + 1),
    InsufficientBalanceError
  );

  const payout = await payoutService.requestPayout(String(seller!._id), 500_000);
  eq('so‘rov yaratildi', payout.status, 'requested');
  eq(
    'pul balansdan darhol rezerv qilindi',
    await balanceOf(String(seller!._id)),
    balance - 500_000
  );
  await assertLedgerBalanced('yechish so‘rovidan keyin');

  // Rejection must give the money back.
  const rejected = await payoutService.reject(String(payout._id), String(seller!._id), 'test');
  eq('rad etildi', rejected.status, 'rejected');
  eq('pul balansga qaytdi', await balanceOf(String(seller!._id)), balance);
  await assertLedgerBalanced('yechish rad etilgandan keyin');

  const second = await payoutService.requestPayout(String(seller!._id), 200_000);
  const paidOut = await payoutService.markPaid(String(second._id), String(seller!._id), 'BANK-REF-1');
  eq('to‘langan deb belgilandi', paidOut.status, 'paid');
  eq(
    'to‘langach balans qaytarilmaydi',
    await balanceOf(String(seller!._id)),
    balance - 200_000
  );
  await assertLedgerBalanced('yechish to‘langandan keyin');
}

async function scenarioSchedulers() {
  section('8. Fon vazifalari — muddat, avtomatik yopish, kod muddati');

  const seller = await makeUser(9301, 'job_seller', 'seller');
  const buyer = await makeUser(9302, 'job_buyer', 'buyer');

  // (a) A payment window that lapses must free the listing again.
  const p1 = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'Muddati o‘tadigan bitim',
    price: 200_000,
    login: 'x',
    password: 'y',
  });
  const pending = await marketplace.initiatePurchase(String(p1._id), String(buyer._id), p1.dealCode!);
  await Transaction.updateOne(
    { _id: pending.transaction._id },
    { $set: { expireAt: new Date(Date.now() - 1000) } }
  );
  const expired = await expirePendingTransactions();
  check('muddati o‘tgan to‘lov yopildi', expired >= 1);

  const tx = await Transaction.findById(pending.transaction._id);
  eq('tranzaksiya yozuvi SAQLANDI (o‘chirilmadi)', tx!.status, 'expired');
  const freed = await Product.findById(p1._id);
  eq('mahsulot yana sotuvga qaytdi', freed!.status, 'active');

  // (b) Revealed + past deadline → seller gets paid.
  const p2 = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'Avtomatik yopiladigan',
    price: 300_000,
    login: 'a',
    password: 'b',
  });
  const buy2 = await marketplace.initiatePurchase(String(p2._id), String(buyer._id), p2.dealCode!);
  const paid2 = await payFor(buy2.uniqueAmount, 'auto');
  const esc2 = await EscrowHold.findOne({ transactionId: paid2.transaction._id });
  await paymentService.revealCredentials(String(esc2!._id), String(buyer._id));
  await EscrowHold.updateOne(
    { _id: esc2!._id },
    { $set: { autoReleaseAt: new Date(Date.now() - 1000) } }
  );

  const sellerBefore = await balanceOf(String(seller._id));
  const settled = await settleDueEscrows();
  eq('ochilgan buyurtma sotuvchiga o‘tdi', settled.released, 1);
  eq(
    'sotuvchi 93% oldi',
    (await balanceOf(String(seller._id))) - sellerBefore,
    279_000
  );

  // (c) Never revealed + past grace → buyer gets everything back.
  const p3 = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'Ochilmagan buyurtma',
    price: 400_000,
    login: 'c',
    password: 'd',
  });
  const buy3 = await marketplace.initiatePurchase(String(p3._id), String(buyer._id), p3.dealCode!);
  const paid3 = await payFor(buy3.uniqueAmount, 'unrevealed');
  const esc3 = await EscrowHold.findOne({ transactionId: paid3.transaction._id });
  await EscrowHold.updateOne(
    { _id: esc3!._id },
    { $set: { autoReleaseAt: new Date(Date.now() - 1000) } }
  );

  const buyerBefore = await balanceOf(String(buyer._id));
  const settled2 = await settleDueEscrows();
  eq('ochilmagan buyurtma qaytarildi', settled2.refunded, 1);
  eq(
    'xaridor 100% qaytarib oldi',
    (await balanceOf(String(buyer._id))) - buyerBefore,
    400_000
  );
  const relisted = await Product.findById(p3._id);
  eq('mahsulot yana sotuvga qo‘yildi', relisted!.status, 'active');

  // (d) An unclaimed deal code must stop working after its window.
  const p4 = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'Ishlatilmagan kod',
    price: 150_000,
    login: 'e',
    password: 'f',
  });
  await Product.updateOne({ _id: p4._id }, { $set: { dealExpiresAt: new Date(Date.now() - 1000) } });
  const killed = await expireUnclaimedDeals();
  check('muddati o‘tgan kod bekor qilindi', killed >= 1);
  eq('eski kod endi ishlamaydi', await marketplace.findDealByCode(p4.dealCode!), null);

  // (e) The code is NOT thrown away: the seller still has it and can reopen the same deal.
  const archived = await Product.findById(p4._id);
  eq('muddati tugagan bitimda kod saqlanib qoldi', archived!.dealCode, p4.dealCode);
  eq('arxiv sababi: muddati tugagan', archived!.archiveReason, 'expired');
  eq('boshqa sotuvchi qayta ocholmaydi', await marketplace.reopenDeal(String(p4._id), String(buyer._id)), null);
  await Product.updateOne({ _id: p4._id }, { $set: { credentialsPurgedAt: new Date() } });
  eq('tozalangan ma’lumotli bitimni qayta ochib bo‘lmaydi', await marketplace.reopenDeal(String(p4._id), String(seller._id)), null);
  await Product.updateOne({ _id: p4._id }, { $unset: { credentialsPurgedAt: '' } });
  const reopened = await marketplace.reopenDeal(String(p4._id), String(seller._id));
  eq('bitim qayta ochildi', reopened!.status, 'active');
  check('qayta ochilgan bitimning muddati kelajakda', reopened!.dealExpiresAt!.getTime() > Date.now() + 6 * 24 * 3600_000);
  check('o‘sha kod yana ishlaydi', Boolean(await marketplace.findDealByCode(p4.dealCode!)));

  // (f) A seller-cancelled deal loses its code for good and cannot be reopened.
  const p5 = await marketplace.createDeal({ sellerId: String(seller._id), title: 'Bekor qilingan', price: 120_000, login: 'm', password: 'n' });
  await marketplace.cancelListing(String(p5._id), String(seller._id));
  eq('bekor qilingan bitimni qayta ochib bo‘lmaydi', await marketplace.reopenDeal(String(p5._id), String(seller._id)), null);

  // (g) A buyer who is late must not cost the seller the deal: releasing the reservation keeps
  // it open even when its original deadline passed during the payment window.
  const p6 = await marketplace.createDeal({ sellerId: String(seller._id), title: 'Kechikkan xaridor', price: 130_000, login: 'o', password: 'p' });
  await marketplace.initiatePurchase(String(p6._id), String(buyer._id), p6.dealCode!);
  await Product.updateOne({ _id: p6._id }, { $set: { dealExpiresAt: new Date(Date.now() - 60_000) } });
  // Another buyer's stale expiry must not free this buyer's live reservation.
  const stranger = await makeUser(9391, 'job_stranger', 'buyer');
  eq('boshqa xaridorning eskirgan bekor qilishi bandlikni bo‘shatmaydi', await paymentService.releaseReservation(String(p6._id), undefined, String(stranger._id)), null);
  eq('bandlik saqlanib qoldi', (await Product.findById(p6._id))!.status, 'reserved');
  await paymentService.releaseReservation(String(p6._id), undefined, String(buyer._id));
  const after = await Product.findById(p6._id);
  eq('to‘lov muddati o‘tgach bitim yana faol', after!.status, 'active');
  check('bitim kamida bir kun ochiq qoladi', after!.dealExpiresAt!.getTime() > Date.now() + 23 * 3600_000);
  // The extension has a ceiling: a deal older than 30 days is not kept alive any further.
  // (createdAt is immutable through Mongoose, so the fixture is rewritten in the raw collection.)
  const ancient = await marketplace.createDeal({ sellerId: String(seller._id), title: 'Eski bitim', price: 110_000, login: 's', password: 't' });
  await Product.collection.updateOne({ _id: ancient._id }, { $set: { createdAt: new Date(Date.now() - 40 * 24 * 3600_000), dealExpiresAt: new Date(Date.now() + 3600_000) } });
  await marketplace.initiatePurchase(String(ancient._id), String(buyer._id), ancient.dealCode!);
  await paymentService.releaseReservation(String(ancient._id), undefined, String(buyer._id));
  check('30 kundan eski bitim muddati uzaytirilmaydi', (await Product.findById(ancient._id))!.dealExpiresAt!.getTime() < Date.now() + 2 * 3600_000);

  // A deal past its deadline cannot be bought while it waits for the sweeper.
  const stale = await marketplace.createDeal({ sellerId: String(seller._id), title: 'Muddati o‘tgan', price: 115_000, login: 'u', password: 'v' });
  await Product.updateOne({ _id: stale._id }, { $set: { dealExpiresAt: new Date(Date.now() - 60_000) } });
  await expectThrow('muddati o‘tgan bitimni sotib olib bo‘lmaydi', () => marketplace.initiatePurchase(String(stale._id), String(buyer._id), stale.dealCode!), ProductUnavailableError);
  await expireUnclaimedDeals();
  eq('sweeper kechikkan xaridor bitimini o‘chirmaydi', (await Product.findById(p6._id))!.status, 'active');

  // (h) Any private deal can be published as a normal catalog listing.
  const p7 = await marketplace.createDeal({ sellerId: String(seller._id), title: 'Katalogga chiqadi', description: 'Bu akkaunt haqida batafsil tavsif, yigirma belgidan ko‘p.', price: 140_000, login: 'q', password: 'r' });
  const published = await marketplace.publishListing(String(p7._id), String(seller._id));
  eq('bitim oddiy e’longa aylandi', published!.listingType, 'public');
  eq('kod olib tashlandi', published!.dealCode, undefined);
  eq('eski kod endi ishlamaydi (e’lon)', await marketplace.findDealByCode(p7.dealCode!), null);
  const inCatalog = await marketplace.getActiveProducts(1, 50);
  check('e’lon katalogda ko‘rinadi', inCatalog.products.some((x: any) => String(x._id) === String(p7._id)));
  await expectThrow('boshqa sotuvchi katalogga chiqara olmaydi', async () => {
    const r = await marketplace.publishListing(String(p6._id), String(buyer._id));
    if (!r) throw new Error('refused');
  });
  await Product.updateOne({ _id: p6._id }, { $set: { description: 'qisqa' } });
  await expectThrow('qisqa tavsifli bitimni chiqarib bo‘lmaydi', () => marketplace.publishListing(String(p6._id), String(seller._id)));

  await assertLedgerBalanced('fon vazifalaridan keyin');
}

async function scenarioBlockedUser() {
  section('9. Bloklangan foydalanuvchi');

  const seller = await makeUser(9401, 'blk_seller', 'seller');
  const blocked = await makeUser(9402, 'blk_buyer', 'buyer');
  blocked.isBlocked = true;
  blocked.blockReason = 'firibgarlik';
  await blocked.save();

  await expectThrow('bloklangan foydalanuvchi rad etiladi', async () =>
    marketplace.assertNotBlocked(await User.findById(blocked._id) as any)
  );

  const deal = await marketplace.createDeal({
    sellerId: String(seller._id),
    title: 'Bloklangan test',
    price: 100_000,
    login: 'g',
    password: 'h',
  });
  await payoutService.setPayoutCard(String(blocked._id), '8600111122223333', 'BLOCKED USER');
  await expectThrow('bloklangan foydalanuvchi pul yecholmaydi', () =>
    payoutService.requestPayout(String(blocked._id), 50_000)
  );
  check('bitim yaratildi (sotuvchi bloklanmagan)', Boolean(deal.dealCode));
}

async function finalIntegrity() {
  section('10. Yakuniy yaxlitlik tekshiruvi');

  await assertLedgerBalanced('yakuniy');

  const drift = await ledgerService.findBalanceDrift();
  eq('kesh va ledger o‘rtasida farq yo‘q', drift.length, 0);

  const negative = await User.countDocuments({ balance: { $lt: 0 } });
  eq('hech kimda manfiy balans yo‘q', negative, 0);

  const stuck = await Product.countDocuments({
    status: 'reserved',
    reservedUntil: { $lt: new Date(Date.now() - 3600_000) },
  });
  eq('osilib qolgan rezervatsiya yo‘q', stuck, 0);

  const balances = await ledgerService.allBalances();
  const revenue = balances[accounts.platformRevenue] ?? 0;
  const escrowFloat = Object.entries(balances)
    .filter(([a]) => a.startsWith('escrow:'))
    .reduce((s, [, v]) => s + v, 0);

  console.log(`\n     platforma daromadi : ${formatUzs(revenue)}`);
  console.log(`     escrow’dagi pul    : ${formatUzs(escrowFloat)}`);
  console.log(`     ledger yozuvlari   : ${await LedgerEntry.countDocuments()}`);
  console.log(`     payout so‘rovlari  : ${await Payout.countDocuments()}`);
}

// ─── runner ────────────────────────────────────────────────────────────────────

async function main() {
  const dbName = new URL(config.mongodbUri.replace('mongodb+srv://', 'https://')).pathname.slice(1);
  if (!/e2e|test/i.test(dbName)) {
    throw new Error(
      `Xavfsizlik to‘sig‘i: e2e faqat nomida "e2e" yoki "test" bo‘lgan bazada ishlaydi. Hozirgi: "${dbName}"`
    );
  }

  console.log(`\n\x1b[1mBitmax — to‘liq e2e sinov\x1b[0m  (baza: ${dbName})`);
  await connectDatabase();

  // Fresh start every run so results are deterministic. Listed one by one rather than in an
  // array — TypeScript can't reconcile deleteMany across a union of differently-typed models.
  await User.deleteMany({});
  await Product.deleteMany({});
  await Transaction.deleteMany({});
  await EscrowHold.deleteMany({});
  await LedgerEntry.deleteMany({});
  await PaymentInbox.deleteMany({});
  await Payout.deleteMany({});

  const ctx = await scenarioPublicSale();
  const escrow = await scenarioPayment(ctx);
  await scenarioRevealAndConfirm(ctx, escrow);
  const deal = await scenarioPrivateDeal();
  await scenarioRefunds(deal);
  await scenarioRefundAbuse();
  await scenarioPayout();
  await scenarioSchedulers();
  await scenarioBlockedUser();
  await finalIntegrity();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\x1b[1mNatija:\x1b[0m ${passed} o‘tdi, ${failed} yiqildi`);
  if (failures.length) {
    console.log('\n\x1b[31mYiqilganlar:\x1b[0m');
    failures.forEach((f) => console.log(`  • ${f}`));
  }
  console.log('');

  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('\n✗ e2e ishlamadi:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
