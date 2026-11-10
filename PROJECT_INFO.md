# Bitmax — loyiha haqida to‘liq ma’lumot

> Yangilangan sana: 2026-11-02. Ushbu hujjat joriy repozitoriydagi kod, konfiguratsiya va mavjud hujjatlar asosida tuzilgan. Production servislar, real to‘lovlar va tashqi akkauntlarning ayni paytdagi holati tekshirilmagan. Quyidagi standart qiymatlarni muhit o‘zgaruvchilari orqali o‘zgartirish mumkin.

## 1. Loyiha nima?

**Bitmax** — raqamli akkauntlarni sotish va sotib olish uchun Telegram bot hamda web platforma. Xaridor to‘lagan pul avval escrow, ya’ni bitim yakunlanguncha ushlab turiladigan hisobda saqlanadi. Xaridor akkaunt ma’lumotlarini ochib tekshiradi, so‘ng bitimni tasdiqlaydi yoki tegishli qaytarish/nizo jarayonidan foydalanadi.

Loyiha papkasi `Bitimax`, mahsulot nomi esa `Bitmax`. Koddagi paketlar `bitmax-backend` va `bitmax-web` deb nomlangan. Telegram botning haqiqiy nomi `BOT_USERNAME` orqali belgilanadi: eski misollarda `bitmax_bot`, keyingi hujjatlarda `bitimax_bot` uchraydi.

Platforma ikki turdagi savdoni qo‘llaydi:

| Savdo turi | Qanday ishlaydi |
| --- | --- |
| Ochiq e’lon — `public` | Katalogda ko‘rinadi, xaridor qidirib topib sotib oladi. |
| Yopiq bitim — `private` | Tomonlar oldindan kelishgan bo‘ladi; sotuvchi ulashadigan maxsus kod orqali bitim ochiladi. Katalogga chiqmaydi. |

Hisob-kitoblar UZSda yuritiladi. Ichki ledger butun so‘mlarda, TezCheck so‘rovlari esa `amount_minor = UZS × 100` formatida ishlaydi.

## 2. Foydalanuvchilar va imkoniyatlar

### Xaridor

- Katalog, kategoriya, matn, narx oralig‘i va e’lon IDsi bo‘yicha qidirish.
- Ochiq e’lonni yoki yopiq bitim kodini ochish.
- Akkauntni vaqtincha band qilish va to‘lov rekvizitlari/to‘lov havolasini olish.
- Buyurtma holatini kuzatish, akkaunt login/parolini ochish.
- Bitimni yakunlash, qaytarish summasini ko‘rish va qaytarish so‘rash.
- Yakunlangan xaridga baho berish, hamyon va buyurtmalar tarixini ko‘rish.

### Sotuvchi

- Web yoki bot orqali akkaunt e’loni va yopiq bitim yaratish.
- Tavsif, narx, kategoriya, maxfiy akkaunt ma’lumotlari va rasmlar kiritish.
- Pul yechish uchun karta va karta egasining ismini saqlash.
- E’lonlar, sotuvlar va hamyonni boshqarish.
- Ruxsat etilgan holatdagi e’lonni bekor qilish va pul yechish so‘rovi yuborish.

### Administrator va moderator

Botda statistika, moderatsiya, pul yechish so‘rovlari, egasi aniqlanmagan to‘lovlar, nizolar va foydalanuvchilar bilan ishlash handlerlari mavjud. Vakolatlar `ADMIN_CHAT_ID`, qo‘shimcha `ADMIN_IDS` va foydalanuvchi roli bilan bog‘liq.

Modelda `buyer`, `seller`, `admin`, `moderator` rollari hamda `new`, `verified`, `trusted`, `partner` ishonch darajalari bor. `uz`, `ru`, `en` til qiymatlari mavjudligi barcha interfeyslar to‘liq tarjima qilinganini anglatmaydi.

## 3. Arxitektura

```text
Web brauzer                         Telegram foydalanuvchisi
     |                                        |
     v                                        v
Next.js web + server proxy             Telegraf bot
     |                                        |
     +--------------+-------------------------+
                    v
        Backend: Express + biznes servislar
              |                  |
              v                  v
           MongoDB           Scheduler
              ^                  |
              +------------------+

Tashqi integratsiyalar:
  TezCheck / SMS gateway -> to‘lovni qabul qilish va tekshirish
  Cloudinary            -> e’lon rasmlari
  Telegram              -> kirishni tasdiqlash va bildirishnomalar
```

Backendning asosiy kirish nuqtasi: [`backend/src/index.ts`](backend/src/index.ts). Express, bot va scheduler odatda bitta uzoq ishlaydigan processda ishga tushadi va MongoDBdan foydalanadi. Bot hamda web umumiy to‘lov, escrow va ledger servislariga tayanadi.

Web Next.js server route’lari orqali backendga murojaat qiladi. Brauzer sessiya cookie’si server tomonda backend uchun `Authorization: Bearer ...` sarlavhasiga aylantiriladi.

## 4. Texnologiyalar

Quyidagilar `package.json`da ko‘rsatilgan versiya oilalari; aniq dependency versiyalari har bir paketning `package-lock.json` faylida saqlanadi.

| Qism | Texnologiyalar |
| --- | --- |
| Backend | TypeScript 5, Node.js, Express 4 |
| Ma’lumotlar bazasi | MongoDB, Mongoose 8 |
| Telegram | Telegraf 4 |
| Validatsiya va himoya | Zod 3, Helmet, CORS, express-rate-limit |
| Web | Next.js 14 App Router, React 18, TypeScript |
| Dizayn | Tailwind CSS 3, PostCSS |
| Testlar | Node.js test runner, `tsx`, alohida integratsiya skriptlari |
| To‘lov sinovlari | Postman simulation va lokal TezCheck mock |
| Joylashtirish | Backend uchun Render konfiguratsiyasi; web uchun Vercel yo‘riqnomasi |
| Container | Ikki bosqichli Dockerfile, `node:20-alpine`, root bo‘lmagan runtime user |

## 5. Papkalar xaritasi

```text
Bitimax/
├── PROJECT_INFO.md            # Ushbu umumiy qo‘llanma
├── backend/
│   ├── src/
│   │   ├── index.ts           # HTTP server, bot va scheduler starti
│   │   ├── config/            # Env, siyosatlar va standart qiymatlar
│   │   ├── db/                # MongoDB ulanishi va listingCode backfill
│   │   ├── models/            # Mongoose modellari
│   │   ├── routes/            # Public, auth, cabinet, internal va webhook API
│   │   ├── middleware/        # Sessiya, internal auth, ObjectId tekshiruvi
│   │   ├── services/          # To‘lov, escrow, ledger, payout, rasmlar
│   │   ├── jobs/              # Davriy vazifalar
│   │   ├── bot/               # Telegram handler, keyboard va wizardlar
│   │   ├── scripts/           # Migratsiya, seed, regressiya testlari
│   │   ├── types/             # Domen turlari va statuslar
│   │   └── utils/             # Shifrlash, JWT, ID va yordamchi funksiyalar
│   ├── .env.example
│   └── Dockerfile
├── web/
│   ├── app/                   # Sahifalar va Next.js API proxy route’lari
│   ├── components/            # Katalog, to‘lov va cabinet interfeyslari
│   ├── lib/                   # API, sessiya, policy va navigation
│   ├── public/                # Logo va statik fayllar
│   └── .env.example
├── docs/                      # Mavzuga oid batafsil hujjatlar
├── postman/
│   ├── mocks/tezcheck/        # Lokal provider mock
│   ├── simulations/tezcheck/  # Simulyatsiya va ishga tushirish konteksti
│   └── tests/                 # Health va public policy tekshiruvlari
└── render.yaml                # Backend deploy Blueprint’i
```

Rootda umumiy `package.json` yo‘q. Backend va web dependency’lari, buyruqlari hamda lockfile’lari alohida boshqariladi. `backup-*` papkalari va haqiqiy `.env` fayllari Gitdan chiqarilgan.

## 6. Savdo jarayoni

### 6.1. E’lon chiqarish

1. Sotuvchi akkaunt va narx haqidagi ma’lumotlarni kiritadi.
2. Maxfiy login/parol va ixtiyoriy rasmlar qo‘shiladi.
3. Botdagi sotish jarayonida payout karta va egasining ismi olinadi.
4. Tasdiqlangach ochiq e’lon **darhol `active` holatda chiqariladi**. Eski hujjatlardagi majburiy dastlabki moderatsiya tavsifi bu oqimga mos emas.
5. E’longa o‘zgarmas olti belgili `listingCode` beriladi. Dastlab `100000…999999`, keyin harf-raqamli kodlar ajratiladi. Kodlar qayta ishlatilmaydi.

Yopiq bitimning ulashish kodi alohida, sakkiz belgili koddir. Uni ommaviy `listingCode` bilan aralashtirmaslik kerak. Bekor qilingan yopiq bitim kodi ishlamaydi.

### 6.2. Xarid va escrow

1. Xaridor e’lonni tanlab rezerv yaratadi; bir e’lonning bir vaqtda ikki kishiga sotilishini oldini olish uchun rezerv atomik olinadi.
2. SMS rejimida aniq summa va karta, TezCheck rejimida hosted checkout havolasi ko‘rsatiladi.
3. Backend to‘lovni tekshiradi va mablag‘ni escrowga yozadi.
4. Xaridor akkaunt ma’lumotlarini **ochadi**. Bu amal bitimni **tasdiqlashdan alohida**.
5. Tasdiqlanganda yoki tegishli avtomatik muddat kelganda hisob-kitob yakunlanib, komissiya ajratiladi va sotuvchining ichki balansiga mablag‘ o‘tadi.
6. Bank kartaga pul chiqarish alohida payout jarayonidir.

Frontenddagi redirect yoki taymer to‘lov tasdig‘i hisoblanmaydi. Yakuniy to‘lov holatini backend belgilaydi. Yozuvchi so‘rov timeout bo‘lsa, natija serverda saqlangan bo‘lishi mumkin; holat tekshirilmasdan xaridni takrorlash kerak emas.

## 7. Pul, komissiya va qaytarish qoidalari

| Sozlama | Standart qiymat |
| --- | --- |
| Platforma komissiyasi | 7% |
| To‘lov uchun rezerv muddati | 10 daqiqa |
| Ma’lumotlar ochilgandan keyingi avtomatik release | 24 soat |
| Ma’lumotlar umuman ochilmasa avtomatik to‘liq refund | 72 soat |
| Minimal pul yechish | 10 000 so‘m |
| Pul yechishning qat’iy to‘lovi | 0 so‘m |
| Refund suiiste’molini nazorat qilish chegarasi | 30 kunlik hisobda 3 |
| Yakunlangan bitim credentiallarini saqlash | 30 kun |
| Bitta e’londagi rasm limiti | 8 |

Qaytarish taymeri akkaunt ma’lumotlari ochilgan vaqtdan boshlanadi:

| Vaqt | Xaridorga qaytadigan ulush |
| --- | --- |
| Ma’lumotlar ochilmagan | 100% |
| Ochilgandan keyin 10 daqiqagacha | 100% |
| 10 daqiqadan oshib, 2 soatgacha | 90% |
| 2 soatdan oshib, 24 soatgacha | 50% |
| 24 soatdan keyin | Avtomatik qaytarish ruxsat etilmaydi |

Amaldagi buyurtma statusi, nizo va arbitraj shartlari ham tekshiriladi. Jadvaldagi foizlar standart policy; `REFUND_TIERS` bilan o‘zgartirilishi mumkin.

Refundda platforma komissiyasi xaridorga va’da qilingan summadan yana ayrilmaydi. U ushlab qolingan jarima qismidan hisoblanadi. Masalan, 100 000 so‘mlik bitimda 10% jarima bo‘lsa, xaridorga 90 000, platformaga 700, sotuvchiga 9 300 so‘m ajratiladi. To‘liq muvaffaqiyatli 100 000 so‘mlik bitimda esa 7 000 komissiya va 93 000 sotuvchi ulushi bo‘ladi.

Refund ichki balansga yoziladi; bu bankka yoki TezCheck orqali avtomatik qaytarildi degani emas. Pul yechish uchun payout ishlatiladi.

Asosiy kod: [`refundEngine.ts`](backend/src/services/refundEngine.ts), [`paymentService.ts`](backend/src/services/paymentService.ts), [`ledgerService.ts`](backend/src/services/ledgerService.ts), [`payoutService.ts`](backend/src/services/payoutService.ts).

## 8. To‘lov integratsiyalari

### SMS — `PAYMENT_PROVIDER=sms`

Xaridor platforma kartasiga aynan ko‘rsatilgan summani o‘tkazadi. SMS gateway xabarni backendga yuboradi; backend uni pending tranzaksiya bilan moslashtiradi. Kiruvchi xabarlar `PaymentInbox`da saqlanadi. Mos kelmagan to‘lovlar admin ko‘rib chiqishi uchun qoladi. `PAYMENT_CARDS` bo‘sh bo‘lsa, SMS orqali normal xarid uchun qabul qiluvchi karta mavjud bo‘lmaydi.

### TezCheck — `PAYMENT_PROVIDER=tezcheck`

Backend bill yaratadi, to‘lov havolasini saqlaydi va provider holatini qayta so‘rab tekshiradi. Request/webhook imzolari, idempotency va takroriy eventlar nazorati mavjud. Real escrow uchun `paid=true`, `payment.state=succeeded`, live muhit, summa, valyuta va reference mosligi talab qilinadi. Test to‘lovi real balansni to‘ldirmaydi.

Webhook qabul qilinganiga javob qaytishi to‘lov tasdiqlanganini bildirmaydi: event saqlanadi, so‘ng provider orqali reconciliation bajariladi. Noaniq holatda rezerv saqlanishi mumkin; timeout ko‘rindi deb mahsulot darhol qayta sotuvga chiqmaydi.

Provider refund/chargeback holatlari operator ko‘rigiga yuboriladi. TezCheck refund/payout API’si bilan avtomatik bank qaytarishi ushbu integratsiyaga kiritilmagan. To‘liq tavsif: [`docs/TEZCHECK.md`](docs/TEZCHECK.md).

## 9. Kirish va xavfsizlik

Webga parol bilan ro‘yxatdan o‘tish o‘rniga Telegram orqali pairing ishlatiladi:

1. Sayt vaqtinchalik login so‘rovi va solishtirish kodini yaratadi.
2. Foydalanuvchi Telegram botda kirishni tasdiqlaydi.
3. Sayt polling orqali natijani olib, bir martalik pairingdan sessiya yaratadi.
4. Sessiya `bx_session` HttpOnly cookie’sida saqlanadi; productionda `Secure`, `SameSite=Lax` ishlatiladi.

Standart login so‘rovi 5 daqiqa, web sessiyasi 7 kun amal qiladi. Logout backendda foydalanuvchining barcha web sessiyalarini bekor qiladi.

Koddagi himoyalar:

- Akkaunt credentiallari va payout karta ma’lumotlarini AES-256-GCM bilan shifrlash.
- Public mahsulot javoblaridan maxfiy ma’lumotlarni chiqarib tashlash.
- Sessiya, egalik, bloklangan user va internal key tekshiruvlari.
- Web yozuvchi proxy so‘rovlarida origin tekshiruvi.
- Global va ayrim endpointlar uchun alohida rate limitlar.
- Helmet, CORS allowlist va webhook sir/imzo tekshiruvlari.
- Muhim amallar uchun audit yozuvlari, ledger va balans reconciliation.
- Productionda asosiy sirlar yo‘q bo‘lsa konfiguratsiyaning xato bilan to‘xtashi.

`ENCRYPTION_KEY` mavjud ma’lumotlarni ochish uchun zarur: uni yo‘qotish yoki qayta shifrlamasdan almashtirish saqlangan credentiallarni o‘qib bo‘lmaydigan qiladi. `SESSION_SECRET` alohida kalit bo‘lib, uning almashtirilishi sessiyalarga ta’sir qiladi. Haqiqiy sirlar ushbu hujjatga kiritilmagan.

## 10. Ma’lumotlar modellari

| Model | Vazifasi |
| --- | --- |
| `User` | Telegram identifikatori, rol, balans keshi, statistika, trust, sozlamalar, payout karta |
| `Product` | Public/private e’lon, narx, rasmlar, shifrlangan credential, status va rezerv |
| `Transaction` | To‘lov kutish jarayoni, summa, provider, muddat va tekshiruv holati |
| `EscrowHold` | Bitimda ushlab turilgan pul, reveal va release muddatlari, nizo bog‘lanishi |
| `LedgerEntry` | Balanslangan moliyaviy yozuvlar va takrorlashdan himoyalovchi kalit |
| `PaymentInbox` | Kelgan SMS va uning matching holati |
| `Payout` | Pul yechish so‘rovi va bajarilish holati |
| `Dispute` | Nizo, dalillar va arbitraj qarori |
| `AuditLog` | Muhim va imtiyozli amallar tarixi |
| `BotSession` | MongoDBda saqlanadigan bot sessiyalari |
| `LoginRequest` | Web–Telegram pairing, tasdiqlash va bir martalik consumption |
| `Sequence` | E’lon kodlari uchun atomik hisoblagich |
| `TezcheckEvent` | Provider eventlari, deduplikatsiya va ko‘rib chiqish holati |

Asosiy holatlar:

- Product: `draft`, `pending_review`, `rejected`, `active`, `reserved`, `sold`, `refunded`, `disputed`, `archived`.
- Transaction: `pending_payment`, `paid`, `expired`, `cancelled`, `refunded`, `completed`.
- Escrow: `holding`, `released`, `refunded`, `partial_refunded`, `disputed`.
- Payout: `requested`, `approved`, `processing`, `paid`, `rejected`, `failed`.

Pul harakatida ledger asosiy hisob manbasi; user balans maydoni keshdir. Moliyaviy tranzaksiyalar uchun MongoDB transaction qo‘llaydigan replica set yoki tegishli Atlas konfiguratsiyasi kerak. Oddiy standalone Mongo katalogni ishga tushirishi mumkin, ammo to‘liq moliyaviy oqim uchun yetarli emas.

## 11. Web sahifalari

| URL | Vazifa |
| --- | --- |
| `/` | Bosh sahifa va katalogga kirish |
| `/katalog` | Alohida katalog sahifasi |
| `/product/[id]` | Mahsulot tafsilotlari |
| `/sotib-olish/[id]` | Xaridni boshlash |
| `/tolov/[id]` | To‘lov jarayoni |
| `/kod` | Yopiq bitim kodini kiritish |
| `/kirish` | Telegram orqali kirish |
| `/shartlar` | To‘lov va qaytarish shartlari |
| `/kabinet` | Shaxsiy kabinet va buyurtmalar |
| `/kabinet/buyurtma/[id]` | Buyurtma, reveal, tasdiqlash va refund |
| `/kabinet/yangi` | Yangi e’lon |
| `/kabinet/bitim` | Yopiq bitim yaratish |
| `/kabinet/sotuv` | Sotuvchi e’lonlari va sotuvlari |
| `/kabinet/hamyon` | Balans va pul yechish |
| `/kabinet/sozlamalar` | Profil sozlamalari |

SEO uchun `robots.ts`, `sitemap.ts`, Open Graph tasviri va mahsulot sahifasi kodi mavjud. Mobil navigatsiya va desktop kabinet menyusi umumiy yo‘nalishlardan foydalanadi.

## 12. Backend API xaritasi

Bu bo‘lim route’lar bo‘yicha umumiy navigatsiya; barcha body/response maydonlarini qamrab oluvchi OpenAPI kontrakti emas. Aniq schema va xatolar uchun [`backend/src/routes`](backend/src/routes) tekshiriladi. Quyidagi yo‘llar backendga tegishli; web proxy barcha backend route’larini birma-bir ochmaydi.

### Ochiq va autentifikatsiya endpointlari

| Metod va yo‘l | Vazifa |
| --- | --- |
| `GET /health`, `GET /healt` | Process liveness |
| `GET /api/products` | Public active katalog |
| `GET /api/products/categories` | Kategoriya va e’lonlar soni |
| `GET /api/products/stats` | Ochiq statistika |
| `GET /api/products/policy` | Komissiya, provider, muddatlar va refund policy |
| `GET /api/products/:id` | Mahsulot tafsiloti |
| `POST /api/auth/start` | Pairing yaratish |
| `GET /api/auth/poll` | Pairing natijasini olish |
| `POST /api/auth/logout` | Sessiya talab qiladi; barcha web sessiyalaridan chiqish |

Katalog parametrlari: `page`, `limit`, `category`, `search`, `sort`, `minPrice`, `maxPrice`. Standart sahifa 1, limit 20, maksimal limit 100. Javob `products` va `pagination: { page, limit, total, pages }`ni qaytaradi. `search=100000` yoki `search=%23100000` orqali qisqa ID qidiriladi; faqat harflardan iborat kod uchun `#` prefiksi oddiy matn qidiruvidan ajratadi.

Mahalliy server ishlayotganda o‘qish misollari:

```bash
curl http://localhost:3001/health
curl 'http://localhost:3001/api/products?page=1&limit=20'
curl http://localhost:3001/api/products/policy
```

Health javobi: `{"status":"ok","service":"bitmax-api","version":"1.0.0"}`. Bu MongoDB, Telegram yoki payment provider tayyorligini tekshirmaydi.

### Sessiya bilan ishlaydigan `/api/me` route’lari

Backend `Authorization: Bearer <session>` talab qiladi; browser uchun bu sarlavhani Next.js proxy yaratadi.

| Metod va nisbiy yo‘l | Vazifa |
| --- | --- |
| `GET /`, `GET /profile` | Profil |
| `PATCH /settings` | Sozlamalar |
| `POST /purchases` | `{ "productId": "<ObjectId>" }` bilan rezerv/to‘lov yaratish |
| `POST /deals/lookup` | Yopiq bitim kodi bo‘yicha qidirish |
| `GET /orders` | Buyurtmalar |
| `GET /transactions/:id/status` | To‘lov holati |
| `GET /orders/:id` | Buyurtma tafsiloti |
| `POST /orders/:id/reveal` | Credentiallarni ochish |
| `POST /orders/:id/confirm` | Bitimni tasdiqlash |
| `GET /orders/:id/refund-quote` | Qaytarish hisob-kitobi |
| `POST /orders/:id/refund` | Refund so‘rashi |
| `POST /orders/:id/rate` | Baho berish |
| `GET /listings`, `POST /listings` | E’lonlarni olish/yaratish |
| `POST /deals` | Yopiq bitim yaratish |
| `POST /listings/:id/cancel` | O‘z e’lonini ruxsat etilgan statusda bekor qilish |
| `GET /sales` | Sotuvlar |
| `GET /wallet` | Hamyon |
| `POST /payout-card` | Payout karta saqlash |
| `POST /payouts` | Pul yechish so‘rovi |
| `POST /uploads` | JPEG, PNG yoki WEBP rasm; raw body, 5 MB limit |

Xarid javobida transaction ID, provider, payment URL, summa, mahsulot, muddat va kerak bo‘lsa karta ma’lumotlari bor. SMSda aynan `uniqueAmount`ga amal qilinadi; TezCheck checkout bazaviy narx bilan yaratiladi. Bular holat o‘zgartiruvchi amallar, oddiy ma’lumot olish so‘rovlari emas.

### Ichki va webhook route’lari

| Yo‘l guruhi | Himoya va vazifa |
| --- | --- |
| `/api/transactions` | `x-internal-key`; tranzaksiyalar ro‘yxati va tafsiloti |
| `/api/escrow` | `x-internal-key`; escrow ro‘yxati, tafsiloti, confirm/refund |
| `POST /api/sms-webhook` | SMS gateway siri va ixtiyoriy sender allowlist |
| `GET /api/sms-webhook/health` | SMS webhook yordamchi health route’i |
| `POST /api/tezcheck/webhook` | Raw body asosidagi provider imzosi |
| `POST /api/telegram/webhook` | Telegram webhook secret token |

Internal key frontend bundle yoki `NEXT_PUBLIC_*` o‘zgaruvchilariga kiritilmaydi. Sessiya yo‘qligi, ruxsat yetishmasligi, noto‘g‘ri ID/body va rate limit alohida xatolar keltiradi; muvaffaqiyatsiz javobni to‘lov yakunlandi deb talqin qilish mumkin emas.

## 13. Muhit o‘zgaruvchilari

Asosiy shablonlar: [`backend/.env.example`](backend/.env.example), [`web/.env.example`](web/.env.example). Yakuniy standartlar [`backend/src/config/index.ts`](backend/src/config/index.ts)da.

| Guruh | O‘zgaruvchilar |
| --- | --- |
| Server va DB | `NODE_ENV`, `PORT`, `MONGODB_URI` |
| Telegram | `BOT_TOKEN`, `BOT_USERNAME`, `BOT_WEBHOOK_URL`, `ADMIN_CHAT_ID`, `ADMIN_IDS`, `SUPPORT_USERNAME` |
| Sirlar | `WEBHOOK_SECRET`, `INTERNAL_API_KEY`, `ENCRYPTION_KEY`, `SESSION_SECRET` |
| Web sessiya | `WEB_SESSION_DAYS`, `LOGIN_REQUEST_MINUTES` |
| To‘lov | `PAYMENT_PROVIDER`, `PAYMENT_CARDS`, `PAYMENT_WINDOW_MINUTES`, `SMS_ALLOWED_SENDERS` |
| TezCheck | `TEZCHECK_API_KEY`, `TEZCHECK_CASH_DESK_CODE`, `TEZCHECK_WEBHOOK_SECRET`, `TEZCHECK_BASE_URL`, `TEZCHECK_PROVIDER_CODES` |
| Moliyaviy siyosat | `PLATFORM_COMMISSION`, `REFUND_TIERS`, `AUTO_RELEASE_HOURS`, `UNREVEALED_GRACE_HOURS`, `MIN_PAYOUT_AMOUNT`, `PAYOUT_FEE_FLAT`, `REFUND_ABUSE_THRESHOLD` |
| Saqlash va rasmlar | `CREDENTIAL_RETENTION_DAYS`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `MAX_PRODUCT_IMAGES` |
| Web va runtime | `SITE_URL`, `CORS_ORIGINS`, `JOBS_ENABLED`, `ALLOW_SELF_PURCHASE` |
| Web paketidagi env | `BACKEND_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BOT_USERNAME` |

Render bergan `RENDER_EXTERNAL_URL` bo‘lsa va `BOT_WEBHOOK_URL` alohida belgilanmasa, Telegram webhook URL avtomatik tuziladi. Lokal muhitda webhook URL bo‘lmasa long polling ishlatiladi. `ALLOW_SELF_PURCHASE` odatda `false`: bu test uchun istisno bo‘lib, haqiqiy sotuvchi statistikasi uchun yoqilmaydi.

## 14. Lokal ishga tushirish

Kerakli vositalar: Node.js va npm, MongoDB replica set, botni sinash uchun Telegram tokeni. Dockerfile Node 20ga asoslangan. Tashqi integratsiyalarni ishlatish uchun tegishli akkaunt va konfiguratsiya ham kerak.

### Backend

Repozitoriy ildizidan:

```bash
cd backend
npm ci
cp .env.example .env
```

Mavjud `.env` bo‘lsa uni ustidan nusxalamang. `.env` ichida mahalliy `MONGODB_URI`, kerakli sirlar, bot va to‘lov sozlamalarini kiriting. Lokal web uchun `SITE_URL=http://localhost:3000`, `CORS_ORIGINS=http://localhost:3000` belgilang. Replica set nomini haqiqiy Mongo sozlamangizga moslang.

Har bir sir uchun alohida tasodifiy qiymat olish:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

So‘ng:

```bash
npm run dev
```

Backend odatda `http://localhost:3001`da ishlaydi. Bot tokensiz ishga tushsa bot qismi o‘tkazib yuboriladi; webga Telegram pairing orqali kirish uchun bot kerak.

### Web

Boshqa terminalda, repozitoriy ildizidan:

```bash
cd web
npm ci
cp .env.example .env.local
```

`BACKEND_URL=http://localhost:3001`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `NEXT_PUBLIC_BOT_USERNAME=<haqiqiy_bot_username>` qilib belgilang. Mavjud `.env.local`ni saqlab qoling.

```bash
npm run dev
```

Web odatda `http://localhost:3000`da ochiladi. Rootdan umumiy `npm run dev` buyrug‘i yo‘q.

## 15. Buyruqlar va tekshiruvlar

### Backend — `backend/` ichidan

| Buyruq | Vazifa |
| --- | --- |
| `npm run dev` | TypeScript watch rejimida API + bot + scheduler |
| `npm run build` | `dist/`ga TypeScript kompilyatsiyasi |
| `npm start` | Tayyor `dist/index.js`ni ishga tushirish |
| `npm run typecheck` | Fayl yaratmasdan turlarni tekshirish |
| `npm test` | Unit testlar |
| `npm run bot` | Alohida bot uchun watch rejimi |
| `npm run bot:build` | Kompilyatsiya va alohida botni ishga tushirish |
| `npm run migrate` | Eski ma’lumotlarni v2 sxemasiga ko‘chirish |
| `npm run seed` | Seed skripti; ishlatishdan oldin target DB va kodni tekshirish kerak |
| `npm run e2e` | Alohida e2e skripti; muhit va yon ta’sirlarini oldindan ko‘rish kerak |
| `npm run test:tezcheck` | Lokal provider + DB integratsiya testi |
| `npm run test:web` | Web proxy + backend regressiyasi |
| `npm run test:marketplace` | Marketplace, kodlar va sotuvchi oqimi regressiyasi |

Asosiy server botni o‘zi ishga tushirgani uchun bir token bilan alohida `npm run bot`ni parallel ishga tushirmang.

### Web — `web/` ichidan

| Buyruq | Vazifa |
| --- | --- |
| `npm run dev` | Next.js development server |
| `npm run build` | Production build |
| `npm start` | Tayyor production buildni ishga tushirish |
| `npm test` | Navigation va redirect testlari |
| `npm run lint` | Paketdagi `next lint` skripti |

Integratsiya testlarining alohida shartlari:

- `test:marketplace`: lokal MongoDB `127.0.0.1:27920`; vaqtinchalik `marketplace_test_*` bazasi yaratiladi va tozalanadi.
- `test:web`: `127.0.0.1:27919`da `tezchecktest` replica set, 3000-portda Next dev va `BACKEND_URL=http://localhost:3001`. Test backendni 3001-portda o‘zi ochadi; bu port bo‘sh bo‘lishi kerak.
- `test:tezcheck`: shu 27919-portdagi replica set va 4919-portda Postman simulation kerak. Yo‘riqnoma: [`tezcheck.context.md`](postman/simulations/tezcheck/tezcheck.context.md).

Simulyatsiyani repo ildizidan boshlash:

```bash
postman simulation run postman/simulations/tezcheck/tezcheck.sim.yaml --port 4919 --output ndjson
```

Mock provider tasdiqlagan rasmiy sandbox emas; loyiha ichidagi kontraktni sinash vositasidir. Lokal test natijasi haqiqiy Click/Payme to‘lovi, production webhook yoki brauzer dizaynini tekshirgan hisoblanmaydi. Ushbu hujjat tayyorlanayotganda dastur testlari qayta ishga tushirilmagan.

## 16. Scheduler

[`backend/src/jobs/scheduler.ts`](backend/src/jobs/scheduler.ts)da yettita davriy vazifa bor:

| Vazifa | Davriylik |
| --- | --- |
| TezCheck to‘lovlarini tiklash va tekshirish | 1 daqiqa |
| Muddati o‘tgan pending tranzaksiyalarni tugatish | 1 daqiqa |
| Muddati kelgan escrowlarni hisob-kitob qilish | 5 daqiqa |
| Mos kelmagan SMS to‘lovlari haqida eslatish | 15 daqiqa |
| Ledger bilan user balanslarini solishtirish | 1 soat |
| Saqlash muddati o‘tgan credentiallarni tozalash | 6 soat |
| Egallanmagan yopiq bitimlar muddatini tugatish | 30 daqiqa |

`JOBS_ENABLED=false` scheduler’ni o‘chiradi. Bir nechta replica ishlatilganda scheduler faqat bitta instansda yoqilishi kerak. Bu process ichidagi `setInterval` ishlaridir: server uxlaganda yoki ishlamay turganda ular bajarilmaydi, shu sabab muddatdagi amal kechikishi mumkin.

## 17. Joylashtirish va migratsiya

Amaldagi [`render.yaml`](render.yaml) quyidagilarni belgilaydi:

- Servis: `bitimax-bot`, Node runtime, `backend` root directory.
- Region: Frankfurt; plan: `free`.
- Build: `npm ci --include=dev && npm run build`.
- Start: `npm start`; health yo‘li: `/health`; auto-deploy yoqilgan.

Bu faylning mavjudligi real Render servisi aynan shu holatda ishlayotganini tasdiqlamaydi. Free servis uyquga kirsa scheduler kechikadi. Web deploy yo‘riqnomasi Vercel uchun yozilgan; `BACKEND_URL`, sayt URLlari va bot username bir-biriga mos bo‘lishi kerak.

Kod va hujjatlardagi web manzili `https://web-three-eosin-46.vercel.app`, backend misoli `https://bitimax-bot.onrender.com`. Ular konfiguratsiya havolalari; ushbu hujjat ularning onlayn ekanini tasdiqlamaydi.

`render.yaml` barcha yangi `.env.example` o‘zgaruvchilarini sanamaydi. TezCheck va Cloudinary kabi integratsiyalar tanlansa, ular uchun env qiymatlarini ham alohida sozlash zarur.

Eski bazani v2ga ko‘chirishda avval backup olinadi. Migratsiya eski transaction TTL indeksini olib tashlash, credentiallarni shifrlash, escrow muddatlarini to‘ldirish, referal kodlar va boshlang‘ich ledger yozuvlarini yaratish hamda reconciliation bilan shug‘ullanadi. Bu ma’lumotlarni o‘zgartiruvchi amal, oddiy ishga tushirish komandasi emas. Joriy server startup’i esa eski e’lonlarga yetishmayotgan `listingCode`larni backfill qiladi.

## 18. Muhim farqlar va cheklovlar

| Eski tasvir yoki taxmin | Joriy kod/hujjatlardan kelib chiqadigan holat |
| --- | --- |
| Web faqat katalog | Webda kirish, savdo, buyurtma, hamyon va sotuvchi kabineti bor. |
| Har bir e’lon avval admin tasdig‘ini kutadi | Joriy yaratish oqimi tasdiqdan so‘ng darhol `active` e’lon chiqaradi; moderatsiya modellari/handlerlari saqlangan. |
| Backend faqat long polling bilan ishlaydi | Webhook rejimi ham bor, Render URL asosida avtomatik tanlanishi mumkin. |
| Render Docker va Starter bilan sozlangan | Hozirgi Blueprint Node runtime va Free planni ko‘rsatadi; Dockerfile alohida variant. |
| Faqat SMS to‘lovi mavjud | TezCheck kodi va lokal simulyatsiyasi ham mavjud; faol provider env orqali tanlanadi. |
| Refund darhol kartaga qaytadi | Refund ichki balansga yoziladi; bankka yechish alohida payout. |
| `/health` barcha integratsiyalarni tekshiradi | Bu faqat process liveness javobi. |
| Modelda til bor — tarjima to‘liq | Til maydonlari mavjud, barcha ekranlar tarjimasi alohida tekshiriladi. |

Eski `docs/TZ-v2.md`dagi roadmap, test sonlari, daromad prognozlari va “bajarildi” yozuvlari tarixiy kontekst hisoblanadi. Ularni joriy production holati yoki real biznes statistikasi sifatida ishlatmaslik kerak. Mobil ilova, Redis navbati yoki alohida web-admin ilovasi ushbu checkoutda alohida loyiha sifatida mavjud emas.

## 19. Muammo izlash uchun yo‘l-yo‘riq

| Belgisi | Avval tekshiriladigan joy |
| --- | --- |
| Backend startda to‘xtaydi | Mongo ulanishi, production sirlar, TezCheck env validatsiyasi |
| Katalog ishlaydi, lekin moliyaviy amal xato beradi | Mongo replica set va transaction qo‘llovi |
| Telegram orqali login tugamaydi | `BOT_TOKEN`, bot username, webhook/polling, pairing muddati |
| Rasm yuklanmaydi | Cloudinary env, fayl turi, 5 MB limit va e’lon rasm limiti |
| SMS to‘lovi topilmaydi | `PaymentInbox`, aniq summa, webhook siri, sender va to‘lov muddati |
| TezCheck to‘lovi ko‘rib chiqishda qoladi | `Transaction.paymentReview`, `TezcheckEvent.review`, provider holati va scheduler |
| Avtomatik release kechikadi | Process faolmi, `JOBS_ENABLED`, servis uyqusi, job loglari |
| Credential ochilmaydi | Saqlashda ishlatilgan `ENCRYPTION_KEY` va retention holati |
| Balanslar mos emas | Ledger reconciliation va audit yozuvlari |
| Web backendga ulanmaydi | `BACKEND_URL`, port, server loglari va origin konfiguratsiyasi |

## 20. Qo‘shimcha manbalar

- [`docs/MARKETPLACE-FLOW.md`](docs/MARKETPLACE-FLOW.md) — e’lon yaratish, IDlar, bot katalogi va bekor qilishning keyingi oqimi.
- [`docs/WEB-EXPERIENCE.md`](docs/WEB-EXPERIENCE.md) — web kabineti, foydalanuvchi yo‘llari va tekshiruv izohlari.
- [`docs/TEZCHECK.md`](docs/TEZCHECK.md) — provider kontrakti, hisob-kitob va tiklash cheklovlari.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — tarixiy deploy/migratsiya qo‘llanmasi; amaldagi Blueprint bilan farqlarni yuqoridagi bo‘limdan ko‘ring.
- [`docs/TZ-v2.md`](docs/TZ-v2.md) — dastlabki v2 talablar, moliyaviy model va tarixiy roadmap.
- [`backend/src/config/index.ts`](backend/src/config/index.ts) — amaldagi konfiguratsiya standartlari.
- [`backend/src/types/index.ts`](backend/src/types/index.ts) — domen statuslari va TypeScript turlari.

Kod va hujjat orasida farq chiqsa, joriy ishlashni route, servis va konfiguratsiya orqali tekshirish kerak; rejalashtirilgan talab esa alohida qayd etiladi.
