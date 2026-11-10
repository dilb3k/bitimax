# Bitmax web experience

Latest marketplace and bot behavior: [Marketplace flow](MARKETPLACE-FLOW.md). Public listings now publish immediately after seller confirmation; the update below supersedes earlier moderation copy.

The website and Telegram bot share the same payment, escrow and ledger services. The project directory stays `Bitimax`; the product label is `Bitmax` and the Telegram account remains `bitimax_bot`.

## User journeys

- Catalog → product → deliberate reservation → payment → order → reveal → final confirmation or refund.
- Private deal → share code → code lookup → same payment/order flow.
- Telegram pairing → return to the original internal page, including seller forms.
- Cabinet: orders (active/history), listings/sales, wallet, account settings. Desktop sidebar and mobile bottom navigation share routes.

Product status disables unavailable purchases. SMS and HamyonAPI payments both show the exact amount to send (HamyonAPI: price plus a few so'm so that open payments differ); accounting always uses the base price. Payment status is authoritative on the server; the client never infers success from a redirect or countdown. A timeout warns that a write may have completed and does not automatically repeat mutations.

## API additions

`GET /api/products/policy` is public, with no auth or secrets. Response fields:

| Field | Type | Meaning |
| --- | --- | --- |
| commission | number | Platform commission percent |
| paymentProvider | sms / hamyon | Active payment flow |
| paymentWindowMinutes | number | Reservation payment window |
| autoReleaseHours | number | Review period after credential reveal |
| unrevealedGraceHours | number | Grace period before unopened orders are refunded |
| refundTiers | array | Configured tiers with id, label, withinMinutes, penaltyPercent, allowed |

The web proxy caches policy for 60 seconds. If unavailable, the interface directs users to authoritative order terms instead of inventing fallback percentages.

`GET /api/me/orders` pending entries additionally return `paymentAmount`, `paymentProvider`, and boolean `paymentReview`. Existing fields remain compatible. No changes to settlement arithmetic.

Logout reports failure when the backend cannot revoke sessions; it no longer silently claims all devices were signed out.

## Validation

- Backend `npm test`: refund arithmetic, HamyonAPI signature/client checks, credentials, SMS matching and sessions.
- Web `npm test`: internal redirect preservation and malicious URL rejection.
- Backend `npm run test:web`: real API routes + Next proxy, local disposable `web_test_*` database only. Run local Mongo on 27919 with replica set `tezchecktest`, and Next dev on 3000 with `BACKEND_URL=http://localhost:3001`. The test starts API port3001; no Telegram bot or external payment provider starts. Fixtures are removed in finally.
- Public policy contract: `postman request https://bitimax-bot.onrender.com/api/products/policy --script-post-request @postman/tests/public-policy.js`.
- Production build checks all routes and TypeScript.

Browser visual verification requires a connected browser; HTTP tests do not establish visual correctness. Provider test payment and real money payment are separate from local regression coverage.

## Usability update — 2026-10-28

- Compact home introduction with three actions: buy, list, or enter a code. The longer explanation is expandable; refund terms remain available.
- Mobile sign-in/cabinet access stays visible; the mobile menu includes listing creation. Touch targets and shared fields use a 44px minimum.
- Seller listings and completed sales have separate tabs. Listing forms group product and private account details and validate title, description and price before submission.
- Buyer order rows explain the next action. Removed redundant buyer summary cards; order amounts and statuses remain in the lists.
- Web decorative emoji replaced with SVG icons or explicit rating text. Telegram keyboards use plain labels and continue recognizing old emoji labels. The bot introduction and help are shorter and describe automatic release correctly.
- Copy failures now give feedback instead of silently doing nothing.

### Health contract

Public `GET /healt` and existing `GET /health` both return HTTP 200 with
`{"status":"ok","service":"bitmax-api","version":"1.0.0"}` and `Cache-Control: no-store`.
These are process liveness endpoints, not database/provider/Telegram readiness probes.
They are mounted before the shared request limiter. Telegram `/healt` and `/health`
reply before session/wizard processing so the command cannot become a credential input.
The standalone bot supports Telegram commands; the HTTP endpoints belong to the API process.

Verification: backend unit tests cover both HTTP aliases and old/new wizard cancellation buttons.
Run the reusable Postman check against each local alias:
`postman request http://127.0.0.1:3199/healt --script-post-request @postman/tests/health.js`.
A health-router-only local server does not establish full production readiness.
No connected browser was available for visual verification during this update.
