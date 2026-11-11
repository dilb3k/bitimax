"use client";

import { Icon } from "@/components/Icon";
import Link from "next/link";
import { useState } from "react";
import { Credentials, RefundQuote, api } from "@/lib/cabinet";
import { formatUzs } from "@/lib/api";
import {
  Badge,
  CopyButton,
  ErrorState,
  Loading,
  Notice,
  SubmitButton,
  formatDateTime,
  useAsync,
} from "../ui";

const REFUND_REASONS: { id: string; label: string }[] = [
  { id: "not_working", label: "Akkaunt ishlamayapti (login/parol noto‘g‘ri)" },
  { id: "wrong_info", label: "E’londagi ma’lumot haqiqatga mos emas" },
  { id: "recovered", label: "Asl egasi akkauntni qaytarib oldi" },
  { id: "other", label: "Boshqa sabab" },
];

export function OrderView({ orderId }: { orderId: string }) {
  const { data, error, loading, reload } = useAsync(
    () => api.order(orderId),
    [orderId],
  );
  const [confirmReady, setConfirmReady] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [refundStep, setRefundStep] = useState<"idle" | "reasons" | "confirm">(
    "idle",
  );
  const [reason, setReason] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error || !data)
    return (
      <ErrorState message={error || "Buyurtma topilmadi"} onRetry={reload} />
    );

  const { order, refundQuote } = data;
  const holding = order.status === "holding";

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setActionError(null);
    try {
      await action();
    } catch (err: any) {
      setActionError(err?.message || "Amalni bajarib bo‘lmadi");
    } finally {
      setBusy(null);
    }
  }

  const reveal = () =>
    run("reveal", async () => {
      const result = await api.reveal(orderId);
      setCredentials(result.credentials);
      if (result.firstReveal)
        setFlash(
          "Ma’lumotlar ochildi — qaytarish muddati shu daqiqadan boshlandi.",
        );
      await reload();
    });

  const confirm = () =>
    run("confirm", async () => {
      const result = await api.confirm(orderId);
      setCredentials(null);
      setFlash(
        `Bitim yakunlandi. Sotuvchiga ${formatUzs(result.sellerPayout)} o‘tkazildi.`,
      );
      await reload();
    });

  const refund = (reasonType: string) =>
    run("refund", async () => {
      const result = await api.refund(orderId, reasonType);
      setRefundStep("idle");
      setCredentials(null);
      setFlash(
        `Qaytarildi: balansingizga ${formatUzs(result.refundToBuyer)} tushdi.`,
      );
      await reload();
    });

  return (
    <div className="space-y-5">
      <Link
        href="/kabinet"
        className="inline-flex text-sm text-muted hover:text-ink"
      >
        ← Buyurtmalarga qaytish
      </Link>

      <div className="surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-snug text-ink">
              {order.product?.title || "Mahsulot"}
            </h1>
            <p className="mt-1 text-xs text-faint">
              {formatDateTime(order.boughtAt)}
            </p>
          </div>
          <Badge
            tone={
              holding ? "accent" : order.status === "released" ? "ok" : "muted"
            }
          >
            {order.statusLabel}
          </Badge>
        </div>

        <p className="tnum mt-4 text-2xl font-bold text-ink">
          {formatUzs(order.amount)}
        </p>

        {holding && (
          <p className="mt-2 text-xs leading-relaxed text-faint">
            {order.revealedAt
              ? `${formatDateTime(order.autoReleaseAt)} gacha javob bermasangiz, pul avtomatik sotuvchiga o‘tadi.`
              : "Ma’lumotlar hali ochilmagan — qaytarish muddati siz ochganingizdan boshlanadi."}
          </p>
        )}
      </div>

      {flash && <Notice tone="ok">{flash}</Notice>}
      {actionError && <Notice tone="warn">{actionError}</Notice>}

      {holding && !credentials && (
        <div className="surface p-5 sm:p-6">
          <h2 className="font-semibold text-ink"><Icon name="key" className="mr-2 inline-block align-text-bottom" /> Akkaunt ma’lumotlari</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {order.revealedAt
              ? "Ma’lumotlar allaqachon ochilgan. Ularni qayta ko‘rsatish muddatni o‘zgartirmaydi."
              : "Ochish tugmasini bosganingizda qaytarish muddati boshlanadi. Avval akkauntga kiring va tekshiring — hech narsani o‘zgartirmang."}
          </p>
          <SubmitButton
            busy={busy === "reveal"}
            onClick={reveal}
            className="btn-accent mt-4"
          >
            {order.revealedAt
              ? "Ma’lumotlarni ko‘rsatish"
              : "Ma’lumotlarni ochish"}
          </SubmitButton>
        </div>
      )}

      {credentials && (
        <div className="surface border-accent/40 p-5 sm:p-6">
          <h2 className="font-semibold text-ink"><Icon name="key" className="mr-2 inline-block align-text-bottom" /> Akkaunt ma’lumotlari</h2>
          <dl className="mt-4 space-y-2.5">
            <Secret label="Login" value={credentials.login} />
            <Secret label="Parol" value={credentials.password} />
            {credentials.recoveryCode && (
              <Secret label="Tiklash kodi" value={credentials.recoveryCode} />
            )}
            {credentials.additionalInfo && (
              <Secret label="Qo‘shimcha" value={credentials.additionalInfo} />
            )}
          </dl>

          <ol className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm leading-relaxed text-muted">
            <li>
              1. Akkauntga kiring va tekshiring — hech narsani o‘zgartirmang.
            </li>
            <li>2. Hammasi joyida bo‘lsa “Tasdiqlayman” ni bosing.</li>
            <li>
              3. Faqat shundan keyin parol va emailni o‘zingizga o‘zgartiring.
            </li>
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            Tasdiqlashdan oldin ma’lumotlarni o‘zgartirsangiz va keyin qaytarish
            so‘rasangiz, sotuvchi dalil bilan nizoni yutib olishi mumkin.
          </p>
        </div>
      )}

      {holding && (
        <div className="surface p-5 sm:p-6">
          {refundStep === "idle" && (
            <>
              <h2 className="font-semibold text-ink">Qaror</h2>
              {confirmReady && (
                <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft/30 p-4">
                  <h3 className="font-semibold">Akkauntni tekshirdingizmi?</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Tasdiqlasangiz, {formatUzs(order.amount)} bo‘yicha bitim
                    yakunlanadi. Pul sotuvchiga o‘tadi va bu amal bekor
                    qilinmaydi.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <SubmitButton busy={busy === "confirm"} onClick={confirm}>
                      Ha, tekshirdim — yakunlash
                    </SubmitButton>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirmReady(false)}
                      className="btn-ghost"
                    >
                      Hali emas
                    </button>
                  </div>
                </div>
              )}
              {/* Hidden while the confirm panel is open so there is exactly one way forward. */}
              {!confirmReady && (
              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <SubmitButton
                  busy={busy === "confirm"}
                  onClick={() => setConfirmReady(true)}
                  disabled={!order.revealedAt || busy !== null}
                  className="btn-accent flex-1"
                >
                  <Icon name="check" /> Tasdiqlayman
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmReady(false);
                    setRefundStep("reasons");
                  }}
                  className="btn-ghost flex-1"
                  disabled={busy !== null}
                >
                  <Icon name="refresh" /> Qaytarish
                </button>
              </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-faint">
                Tasdiqlagach pul sotuvchiga o‘tadi va buni orqaga qaytarib
                bo‘lmaydi.
              </p>
            </>
          )}

          {refundStep === "reasons" && (
            <RefundReasons
              quote={refundQuote}
              onCancel={() => setRefundStep("idle")}
              onPick={(picked) => {
                setReason(picked);
                setRefundStep("confirm");
              }}
            />
          )}

          {refundStep === "confirm" && reason && (
            <>
              <h2 className="font-semibold text-ink">Qaytarishni tasdiqlash</h2>
              <p className="mt-2 text-sm text-muted">
                Sabab:{" "}
                <strong className="text-ink">
                  {REFUND_REASONS.find((r) => r.id === reason)?.label}
                </strong>
              </p>
              {refundQuote?.allowed && (
                <p className="tnum mt-3 text-sm text-muted">
                  Sizga qaytariladi:{" "}
                  <strong className="text-ink">
                    {formatUzs(refundQuote.refundToBuyer)}
                  </strong>
                </p>
              )}
              <p className="mt-3 text-xs text-faint">
                Bu amalni bekor qilib bo‘lmaydi.
              </p>

              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <SubmitButton
                  busy={busy === "refund"}
                  onClick={() => refund(reason)}
                  className="btn-accent flex-1"
                >
                  Ha, qaytarish
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setRefundStep("idle")}
                  className="btn-ghost flex-1"
                >
                  Bekor qilish
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!holding && !order.rated && (
        <RatingBox
          orderId={orderId}
          busy={busy === "rate"}
          onRate={(value) =>
            run("rate", async () => {
              await api.rate(orderId, value);
              setFlash("Rahmat! Bahoyingiz saqlandi.");
              await reload();
            })
          }
        />
      )}

      {order.rated && (
        <Notice tone="info">
          Sizning bahoyingiz: {order.rating || 0} / 5
        </Notice>
      )}
    </div>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-raised px-3.5 py-2.5">
      <div className="min-w-0">
        <dt className="text-xs text-faint">{label}</dt>
        <dd className="mt-0.5 break-all font-mono text-sm text-ink">{value}</dd>
      </div>
      <CopyButton value={value} label="Nusxa olish" name={label} />
    </div>
  );
}

/** Shows exactly what a refund pays before the buyer commits to one. */
function RefundReasons({
  quote,
  onPick,
  onCancel,
}: {
  quote: RefundQuote | null;
  onPick: (reason: string) => void;
  onCancel: () => void;
}) {
  if (quote && !quote.allowed) {
    return (
      <>
        <h2 className="font-semibold text-ink">
          Avtomatik qaytarish mumkin emas
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {quote.message}
        </p>
        <button type="button" onClick={onCancel} className="btn-ghost mt-4">
          Orqaga
        </button>
      </>
    );
  }

  return (
    <>
      <h2 className="font-semibold text-ink">Qaytarish hisob-kitobi</h2>

      {quote && (
        <dl className="mt-3 space-y-1.5 rounded-lg bg-raised px-3.5 py-3 text-sm">
          <QuoteRow
            label="Davr"
            value={`${quote.label} (${quote.elapsedMinutes} daqiqa)`}
          />
          <QuoteRow
            label="Jarima"
            value={`${quote.penaltyPercent}% — ${formatUzs(quote.penaltyAmount)}`}
          />
          <QuoteRow
            label="Sizga qaytariladi"
            value={formatUzs(quote.refundToBuyer)}
            strong
          />
        </dl>
      )}

      {quote?.requiresArbitration && (
        <p className="mt-3 text-xs leading-relaxed text-warn">
          So‘nggi 30 kunda ko‘p qaytarish qayd etilgan — bu so‘rov ham hisobga
          olinadi va profilingiz keyingi tekshiruvlarda ko‘rib chiqiladi.
        </p>
      )}

      <p className="mt-4 text-sm text-muted">Sababni tanlang:</p>
      <div className="mt-2 space-y-2">
        {REFUND_REASONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            className="w-full rounded-lg border border-line px-3.5 py-2.5 text-left text-sm text-muted transition hover:border-accent/50 hover:text-ink"
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className="btn-ghost mt-4 w-full"
      >
        Bekor qilish
      </button>
    </>
  );
}

function QuoteRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-faint">{label}</dt>
      <dd
        className={strong ? "tnum font-semibold text-ink" : "tnum text-muted"}
      >
        {value}
      </dd>
    </div>
  );
}

function RatingBox({
  busy,
  onRate,
}: {
  orderId: string;
  busy: boolean;
  onRate: (value: number) => void;
}) {
  return (
    <div className="surface p-5 text-center sm:p-6">
      <h2 className="font-semibold text-ink">Sotuvchini baholang</h2>
      <p className="mt-1 text-sm text-muted">
        Bu boshqa xaridorlarga yordam beradi.
      </p>
      <div className="mt-4 flex justify-center gap-1.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={() => onRate(value)}
            aria-label={`${value} yulduz`}
            className="min-h-[44px] min-w-[44px] rounded-md px-2 py-1 text-2xl leading-none transition hover:scale-110 disabled:opacity-50"
          >
            <Icon name="star" width={28} height={28} fill="currentColor" />
          </button>
        ))}
      </div>
    </div>
  );
}
