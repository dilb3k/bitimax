# Bitimax

Telegram orqali ishlaydigan kafolatli (escrow) akkaunt savdo platformasi: sayt + API + bot.

```
Bitimax/
├── web/       Next.js sayt (Vercel)      → faqat backend API bilan gaplashadi
├── backend/   Express API + scheduler    → pul qoidalari, to'lov callbacklari, ma'lumotlar bazasi
├── bot/       Telegram bot (Telegraf)    → alohida servis, webhook orqali ishlaydi
├── docs/      DEPLOY, TZ, oqimlar
├── postman/   Smoke testlar
└── render.yaml  ikkita Render servisi: bitimax-api va bitimax-bot
```

## Qanday bog'langan

```
 Brauzer ──► web (Vercel) ──x-web-key──► backend (Render: bitimax-api) ──► MongoDB
                                              ▲                              ▲
 Hamyon callback ─────────────────────────────┘                              │
 Telegram ──webhook──► bot (Render: bitimax-bot) ────────────────────────────┘
```

- **backend** — yagona "haqiqat manbai": modellar, escrow/to'lov/payout xizmatlari, scheduler. Botga xabar faqat *yuboradi*.
- **bot** — alohida jarayon. Domen kodini `bot/src/core.ts` orqali oladi (bot ↔ backend o'rtasidagi yagona eshik). Sayt sessiyasini imzolash, SMS webhook, ichki kalit kabi API sirlari botda **yo'q**.
- **web** — brauzer hech qachon backendga to'g'ridan-to'g'ri murojaat qilmaydi; sessiya httpOnly cookie'da.

## Lokal ishga tushirish

```bash
# 1) backend
cd backend && cp .env.example .env && npm ci && npm run dev      # :3001
# 2) bot (long polling, BOT_TOKEN kerak)
cd bot && cp .env.example .env && npm ci && npm run dev           # :3002
# 3) web
cd web && cp .env.example .env.local && npm ci && npm run dev    # :3000
```

Testlar: `cd backend && npm test` · `cd bot && npm test` · `cd web && npm test` ·
integratsiya: `npm run e2e` (backend, replica-set Mongo kerak) va `npm run test:marketplace` (bot).

Deploy va xavfsizlik: [`docs/DEPLOY.md`](docs/DEPLOY.md).
