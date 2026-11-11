# Bitimax — Deploy qo'llanmasi

Uch qism, uchalasi **alohida** joylashtiriladi:

| Qism | Qayerda | Vazifasi |
|---|---|---|
| `backend/` | **Render** — `bitimax-api` | HTTP API, Hamyon callback, scheduler (`JOBS_ENABLED=true`) |
| `bot/` | **Render** — `bitimax-bot` | Telegram bot, webhook rejimida |
| `web/` | **Vercel** | Sayt (SSR) |

> Backend va botni Vercel'ga qo'yib bo'lmaydi: scheduler (`setInterval`) va doimiy ulanishlar serverless'da o'ladi.

## Servislar orasidagi sirlar

| O'zgaruvchi | api | bot | web | Izoh |
|---|:-:|:-:|:-:|---|
| `MONGODB_URI`, `ENCRYPTION_KEY`, `BOT_TOKEN`, `ADMIN_CHAT_ID`, `HAMYON_*`, `PAYMENT_CARDS`, `CLOUDINARY_*` | ✅ | ✅ | | **Ikkalasida bir xil**. `ENCRYPTION_KEY` farq qilsa — parollar o'qilmaydi |
| `SESSION_SECRET`, `WEBHOOK_SECRET`, `INTERNAL_API_KEY` | ✅ | ❌ | | Faqat API. Bot ularni olmaydi |
| `WEB_PROXY_KEY` | ✅ | | ✅ | API va saytda **bir xil**. Qo'yilgach `/api/me` va `/api/auth` saytdan boshqaga yopiladi |
| `BACKEND_URL` | | | ✅ | `https://<bitimax-api>.onrender.com` |
| `NEXT_PUBLIC_BOT_USERNAME`, `NEXT_PUBLIC_SITE_URL` | | | ✅ | Bot havolasi va sayt manzili (build vaqtida) |
| `DEMO_PAYMENTS` | ✅ | ✅ | | **Ikkalasida bir xil**. Quyidagi "Demo rejim" bo‘limiga qarang |
| `PAYOUT_CARD_COOLDOWN_HOURS` | ✅ | ✅ | | Yangi karta saqlangandan keyin necha soat yechib bo‘lmaydi (standart 24) |
| `TEST_AUTO_CONFIRM_ADMIN` | ✅ | ✅ | | Faqat sinov uchun; productionda `false` |
| `SERVICE_ROLE=bot` | | ✅ | | Botni "kam huquqli" rejimga o'tkazadi |

## Xavfsizlik qoidalari (kodda majburlangan)

- `ALLOW_SELF_PURCHASE=true` bilan production **ishga tushmaydi**.
- `PAYMENT_PROVIDER=hamyon` bo'lsa SMS-webhook umuman ulanmaydi (soxta SMS bilan "to'landi" qilib bo'lmaydi). Hamyon callback imzo (`sign`), summa va buyurtma bo'yicha tekshiriladi.
- `/api/escrow` va `/api/transactions` (kalit bilan refund/release) `ENABLE_INTERNAL_API=true` bo'lmasa ulanmaydi.
- Barcha so'rovlarda `$`/`.` kalitlari (NoSQL injection) rad etiladi.
- Autentifikatsiyalangan limitlar foydalanuvchi bo'yicha, kirish limitlari saytdan uzatilgan haqiqiy IP bo'yicha.
- Telegram webhook `secret_token` (bot tokenidan HMAC) bilan himoyalangan.
- Barcha admin amallari `isAdminTelegramId` bilan tekshiriladi.

## Deploy tartibi

1. `render.yaml` ni Render Blueprint sifatida import qiling yoki ikkita web service qo'lda yarating (`rootDir: backend` va `rootDir: bot`, build `npm ci --include=dev && npm run build`, start `npm start`).
2. Sirlarni yuqoridagi jadval bo'yicha kiriting.
3. Vercel (loyiha Git bilan bog'lanmagan, deploy qo'lda): `web/` ichida `BACKEND_URL`, `WEB_PROXY_KEY`, `NEXT_PUBLIC_BOT_USERNAME` ni qo'ying va `vercel deploy --prod` qiling. Funksiyalar `web/vercel.json` bilan `fra1` (Frankfurt) regioniga qadalgan: backend ham Frankfurtda, aks holda har so'rov okeandan o'tadi.
   `WEB_PROXY_KEY` Renderda `sync: false`, ya'ni dashboardda qo'lda kiritiladi; ikki tomonda bir xil bo'lishi shart.
4. Hamyon dashboard: `prepare_url=https://<api>/api/payments/hamyon/prepare`, `complete_url=https://<api>/api/payments/hamyon/complete`.
5. Bot webhook'ni o'zi ro'yxatdan o'tkazadi (`RENDER_EXTERNAL_URL/telegram/webhook`).
6. Tekshiruv: `GET <api>/health`, `GET <bot>/health`, botga `/start`.

Free planda servislar uxlaydi: Telegram webhook botni uyg'otadi, lekin API'dagi scheduler (to'lov muddati / avto-release) uyqu paytida to'xtaydi — jiddiy ishga tushirishda `starter` planga o'ting.

## Demo rejim (`DEMO_PAYMENTS`)

`DEMO_PAYMENTS=true` bo'lsa, "To'lash" bosilishi bilan buyurtma darrov to'langan hisoblanadi (haqiqiy pul yo'q): escrow va ledger oddiy to'lovdagi kod bilan to'ldiriladi, faqat bank kirimi simulyatsiya qilinadi. **Pul yechish (payout) bu rejimda yopiq**, chunki soxta balansni haqiqiy pulga aylantirib bo'lmaydi. `render.yaml` hozir uni ikkala servis uchun `true` qiladi.

Haqiqiy to'lovga qaytish: ikkala servisda `DEMO_PAYMENTS` ni `false` qiling yoki o'chiring (ikkalasida bir xil bo'lsin). Hamyon kodi o'zgartirilmagan.

## 0. Deploydan OLDIN: sirlarni rotatsiya qiling

Eski MongoDB paroli hujjatlarda ochiq bo'lgan (`docs/TZ-v2.md` §11.1). Deploy qilishdan oldin:

1. **Atlas → Database Access** → parolni o'zgartiring
2. **Atlas → Network Access** → `0.0.0.0/0` ni o'chiring, Render statik IP'larini qo'shing
3. **@BotFather → /revoke** → yangi BOT_TOKEN oling

## 1. Sirlarni generatsiya qiling

```bash
# Har biri uchun alohida ishga tushiring
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Kerak bo'ladigan uchta qiymat:

| O'zgaruvchi | Vazifasi |
|---|---|
| `WEBHOOK_SECRET` | SMS-gateway shu bilan autentifikatsiya qiladi |
| `INTERNAL_API_KEY` | Ichki API himoyasi |
| `ENCRYPTION_KEY` | **Akkaunt parollarini shifrlaydi** |

> 🔑 `ENCRYPTION_KEY` yo'qolsa — barcha saqlangan login/parollar **abadiy o'qib bo'lmas** holga keladi. Uni parol menejeriga yoki qog'ozga yozib, Render'dan tashqarida saqlang. Hech qachon o'zgartirmang (avval mavjud yozuvlarni qayta shifrlamasdan).

## 2. Migratsiyani ishga tushiring — backend deploydan OLDIN

Bu eng muhim qadam. Yangi kod v2 sxemasini kutadi; migratsiya qilinmagan bazada:

- eski TTL indeks tranzaksiyalarni o'chirishda **davom etadi**
- eski parollar ochiq matnda qoladi
- `EscrowHold` da `autoReleaseAt` bo'lmagani uchun avtomatik settlement ishlamaydi

```bash
# 0) MAJBURIY zaxira nusxa
mongodump --uri="<YANGI_MONGODB_URI>" --out=./backup-$(date +%F)

# 1) .env ni to'ldiring (backend/.env.example dan nusxa oling)
cd backend
cp .env.example .env
#   → MONGODB_URI, ENCRYPTION_KEY, BOT_TOKEN, ADMIN_CHAT_ID, ... ni yozing

# 2) Migratsiya (bir necha marta ishga tushirish xavfsiz)
npm run migrate
```

Kutilayotgan natija:

```
▶ Bitmax v1 → v2 migration
  ✓ Dropped TTL index "expireAt_1" — expired transactions are now retained
  ✓ Encrypted credentials for N product(s)
  ✓ Backfilled deadlines for N escrow hold(s)
  ✓ Generated referral codes for N user(s)
  ✓ Marked N stale pending transaction(s) as expired
  ✓ Seeded opening balances for N user(s)
✓ Ledger and cached balances agree
```

Oxirgi qator `⚠ N account(s) still drift` bo'lsa — **deploy qilmang**, avval sababni toping.

## 3. Birinchi bitimni sinash

Deploydan keyin, real pul bilan **eng arzon** test bitimini o'tkazing:

1. Ikkita Telegram akkaunt: biri sotuvchi, biri xaridor
2. Sotuvchi 1 000 so'mlik e'lon qo'yadi (e'lon darhol faol bo'ladi)
3. Xaridor sotib oladi → **aniq summa** ni o'tkazadi
4. Bot 1–2 daqiqada "To'lov qabul qilindi" xabarini yuborishi kerak
5. "🔑 Ma'lumotlarni ochish" → login/parol chiqadi
6. "✅ Tasdiqlayman" → sotuvchi balansiga 930 so'm tushadi
7. Admin botda **📊 Statistika** → `Platforma daromadi: 70 UZS`

Har bir qadam ishlasa — tizim to'liq ishlayapti.

## 7. Deploydan keyin kuzatish

Har kuni admin botda tekshiring:

| Ko'rsatkich | Bo'lishi kerak | Bo'lmasa |
|---|---|---|
| 📥 Egasi topilmagan to'lovlar | **0** | SMS parsing yoki oyna muddati muammosi |
| Balans drifti (avtomatik xabar) | **hech qachon kelmasligi** | Kod pulni ledgerdan tashqari ko'chiryapti |
| 🛡 Moderatsiya navbati | bo'sh | Sotuvchilar kutmoqda |
| 💸 To'lov so'rovlari | 24 soat ichida yopilgan | Foydalanuvchi ishonchi |

---

## Muammolarni bartaraf qilish

| Belgi | Sabab | Yechim |
|---|---|---|
| Bot javob bermaydi | Render `free` planda uxlab qolgan | `starter` ga o'ting |
| `Credential could not be decrypted` | `ENCRYPTION_KEY` migratsiyadagidan farq qiladi | To'g'ri kalitni qaytaring |
| To'lov tasdiqlanmayapti | SMS matni regexga mos emas | Render logida `[SMS Webhook]` ni ko'ring; `PaymentInbox` da xom matn saqlangan |
| Muddati o'tgan tranzaksiyalar yo'qolyapti | TTL indeks hali o'chirilmagan | `npm run migrate` ni ishga tushiring |
| `Missing required environment variable` | Render'da sir kiritilmagan | Blueprint'dagi `sync: false` ro'yxatini tekshiring |
