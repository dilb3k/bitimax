/**
 * Verifies DEMO_PAYMENTS: pressing pay confirms the order at once and escrow behaves like a real
 * payment (hold created, product sold, ledger balanced).
 *
 * Run with:  DEMO_PAYMENTS=true MONGODB_URI=<throwaway replica-set db with "test" in its name> npm run test:demo
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { config } from '../config';
import { connectDatabase } from '../db/mongoose';
import { User } from '../models/User';
import { Product } from '../models/Product';
import { EscrowHold } from '../models/EscrowHold';
import { marketplace } from '../services/marketplaceService';
import { ledgerService } from '../services/ledgerService';

async function main() {
  assert.ok(config.demoPayments, 'Set DEMO_PAYMENTS=true to run this test');
  await connectDatabase();
  const dbName = mongoose.connection.name;
  assert.ok(/test/i.test(dbName), `Refusing to wipe non-test database "${dbName}"`);
  await mongoose.connection.dropDatabase();

  const seller = await User.create({ telegramId: 1, username: 's', firstName: 's', role: 'seller', referralCode: 'r1', trustLevel: 'trusted' });
  const buyer = await User.create({ telegramId: 2, username: 'b', firstName: 'b', role: 'buyer', referralCode: 'r2', trustLevel: 'trusted' });
  const deal = await marketplace.createDeal({ sellerId: String(seller._id), title: 'Demo', price: 100_000, login: 'l', password: 'p' });

  const result = await marketplace.initiatePurchase(String(deal._id), String(buyer._id), deal.dealCode!);
  assert.equal(result.demo, true);
  assert.equal(result.transaction.status, 'paid');

  const hold = await EscrowHold.findOne({ transactionId: result.transaction._id });
  assert.ok(hold, 'escrow hold created');
  assert.equal(hold!.status, 'holding');
  assert.equal(hold!.amount, 100_000);
  assert.equal((await Product.findById(deal._id))!.status, 'sold');

  const total = Object.values(await ledgerService.allBalances()).reduce((a, b) => a + b, 0);
  assert.equal(total, 0, 'ledger balanced');

  await assert.rejects(marketplace.initiatePurchase(String(deal._id), String(buyer._id), deal.dealCode!), 'cannot buy twice');
  const { payoutService } = await import('../services/payoutService');
  await assert.rejects(payoutService.requestPayout(String(seller._id), 50_000), /Demo rejimida/, 'payouts closed in demo mode');

  console.log('demo payment: OK');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('demo payment: FAILED', err);
  process.exit(1);
});
