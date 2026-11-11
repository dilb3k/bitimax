/** Local-only HTTP regression of the web proxy against real API routes and a disposable database. */
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    BOT_TOKEN: "",
    ADMIN_CHAT_ID: "",
    JOBS_ENABLED: "false",
    PAYMENT_PROVIDER: "sms",
    SESSION_SECRET: "local_web_regression_session",
    ENCRYPTION_KEY: "1".repeat(64),
    PAYMENT_CARDS: JSON.stringify([
      {
        id: "fixture",
        number: "8600000000000000",
        holder: "LOCAL TEST",
        bank: "Fixture",
        active: true,
      },
    ]),
    WEBHOOK_SECRET: "local-web-test",
    INTERNAL_API_KEY: "local-web-test",
    ALLOW_SELF_PURCHASE: "false",
  });
  const { default: products } = await import("../routes/products");
  const { default: me } = await import("../routes/me");
  const { default: auth } = await import("../routes/auth");
  const { Product } = await import("../models/Product");
  const { User } = await import("../models/User");
  const { Transaction } = await import("../models/Transaction");
  const { LoginRequest } = await import("../models/LoginRequest");
  const { sha256 } = await import("../utils/crypto");
  const { paymentService } = await import("../services/paymentService");
  const { EscrowHold } = await import("../models/EscrowHold");
  const { LedgerEntry } = await import("../models/LedgerEntry");
  const { AuditLog } = await import("../models/AuditLog");
  const dbName = `web_test_${Date.now()}`;
  await mongoose.connect(
    `mongodb://127.0.0.1:27919/${dbName}?replicaSet=bitimaxtest`,
  );
  await Promise.all([
    Product.init(),
    User.init(),
    Transaction.init(),
    LoginRequest.init(),
    EscrowHold.init(),
    LedgerEntry.init(),
    AuditLog.init(),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/products", products);
  app.use("/api/me", me);
  app.use("/api/auth", auth);
  const server = app.listen(3001, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let checks = 0;
  const check = (condition: unknown, message: string) => {
    assert.ok(condition, message);
    checks++;
    console.log("PASS:", message);
  };
  const base = "http://127.0.0.1:3000";
  const jar = new Map<string, string>();
  async function request(
    path: string,
    body?: object,
    method = body ? "POST" : "GET",
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const data: any = await res.json();
    return { res, data };
  }
  try {
    const seller = await User.create({
      telegramId: 880001,
      firstName: "Test sotuvchi",
      role: "seller",
      trustLevel: "trusted",
    });
    const buyer = await User.create({
      telegramId: 880002,
      firstName: "Test xaridor",
    });
    const product = await Product.create({
      sellerId: seller._id,
      title: "Web regression akkaunt",
      description: "Disposable local fixture only",
      price: 150000,
      category: "Boshqa",
      status: "active",
      sensitiveData: { login: "local-only", password: "local-only" },
    });
    const publicPolicy = await request("/api/products/policy");
    check(
      publicPolicy.res.status === 200 &&
        publicPolicy.data.paymentProvider === "sms" &&
        Array.isArray(publicPolicy.data.refundTiers),
      "public policy survives Next proxy",
    );
    check(
      !JSON.stringify(publicPolicy.data).includes("local-web-test"),
      "policy contains no server secrets",
    );
    check(
      (await request("/api/me/orders")).res.status === 401,
      "cabinet requires session",
    );
    const redirect = await fetch(base + "/kabinet/yangi", {
      redirect: "manual",
    });
    check(
      redirect.status === 307 &&
        redirect.headers.get("location")?.includes("next=%2Fkabinet%2Fyangi"),
      "deep login destination retained",
    );
    const csrf = await fetch(base + "/api/auth/start", {
      method: "POST",
      headers: { Origin: "https://foreign.invalid" },
    });
    check(csrf.status === 403, "cross-origin login rejected");
    await request("/api/auth/start", {});
    const pairing = jar.get("bx_pair")!;
    await LoginRequest.updateOne(
      { tokenHash: sha256(pairing) },
      { $set: { status: "approved", userId: buyer._id } },
    );
    const poll = await request("/api/auth/poll");
    check(
      poll.data.status === "approved" && jar.has("bx_session"),
      "approved pairing sets browser session",
    );
    const purchase = await request("/api/me/purchases", {
      productId: String(product._id),
    });
    check(
      purchase.res.status === 200,
      "purchase works through authenticated web proxy",
    );
    const id = purchase.data.transactionId;
    let orders = await request("/api/me/orders");
    check(
      orders.data.pending[0].paymentAmount === purchase.data.uniqueAmount,
      "SMS pending amount is exact payable amount",
    );
    await Transaction.updateOne(
      { _id: id },
      { $set: { paymentProvider: "hamyon", hamyonAmount: 150001, paymentReview: "fixture" } },
    );
    orders = await request("/api/me/orders");
    check(
      orders.data.pending[0].paymentAmount === 150001 &&
        orders.data.pending[0].paymentReview === true,
      "HamyonAPI pending amount is the exact requested amount and flags review",
    );
    await Transaction.updateOne(
      { _id: id },
      { $set: { paymentProvider: "sms" }, $unset: { paymentReview: "" } },
    );
    await paymentService.confirmPaymentBySms(
      `Hisobingizga ${purchase.data.uniqueAmount} so'm tushdi. local web regression`,
      "TEST-BANK",
      Date.now(),
    );
    const paid = await request(`/api/me/transactions/${id}/status`);
    check(
      paid.data.status === "paid" && paid.data.orderId,
      "payment creates web-accessible order",
    );
    const orderId = paid.data.orderId;
    const reveal = await request(`/api/me/orders/${orderId}/reveal`, {});
    check(
      reveal.res.status === 200 &&
        reveal.data.credentials?.login === "local-only",
      "buyer can reveal paid order",
    );
    const confirm = await request(`/api/me/orders/${orderId}/confirm`, {});
    check(confirm.res.status === 200, "buyer can confirm from web");
    const html = await (await fetch(base + "/")).text();
    check(
      html.includes("Kelishuv sizdan.") && html.includes("Raqamli katalog"),
      "landing renders new design",
    );
    const detail = await (await fetch(base + `/product/${product._id}`)).text();
    check(
      detail.includes("Sotilgan") &&
        !detail.includes(`href="/sotib-olish/${product._id}"`),
      "sold product has no purchase CTA",
    );
    const logout = await request("/api/auth/logout", {});
    check(
      logout.res.status === 200 && !jar.get("bx_session"),
      "logout revokes session and clears browser cookie",
    );
    check(
      (await request("/api/me/orders")).res.status === 401,
      "cabinet rejects after logout",
    );
    console.log(
      `WEB REGRESSION: ${checks} checks passed, local fixtures only.`,
    );
  } finally {
    server.close();
    assert.ok(mongoose.connection.name.startsWith("web_test_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
