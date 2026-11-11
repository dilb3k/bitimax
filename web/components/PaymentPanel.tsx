"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUzs } from "@/lib/api";
import { Icon } from "./Icon";
import { api } from "@/lib/cabinet";
import {
  Countdown,
  CopyButton,
  ErrorState,
  Loading,
  Notice,
  Spinner,
  formatDateTime,
} from "./ui";

type Status = Awaited<ReturnType<typeof api.transactionStatus>>;

/**
 * The payment screen: the exact amount to transfer, the card to send it to, and a clock.
 *
 * Confirmation is not something the browser can decide — it arrives as a bank SMS on the
 * platform's side — so this polls until the backend says the money landed, then hands the
 * buyer straight to the order where the credentials wait.
 */
export function PaymentPanel({ transactionId }: { transactionId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const data = await api.transactionStatus(transactionId);
      if (alive.current) {
        setStatus(data);
        setError(null);
      }
    } catch (err: any) {
      if (alive.current) setError(err?.message || "Holatni olib bo‘lmadi");
    } finally {
      inFlight.current = false;
      if (alive.current) setChecking(false);
    }
  }, [transactionId]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (status?.status !== "pending_payment") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    const resume = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [status?.status, load]);

  if (error && !status) return <ErrorState message={error} onRetry={load} />;
  if (!status) return <Loading label="To‘lov ma’lumotlari yuklanmoqda…" />;

  if (status.status === "paid" || status.status === "completed") {
    return (
      <div className="surface p-6 text-center sm:p-8">
        <p className="text-3xl" aria-hidden="true">
          <Icon name="check" width={32} height={32} className="mx-auto text-ok" />
        </p>
        <h2 className="mt-3 text-xl font-bold text-ink">To‘lov tasdiqlandi</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          Pul kafilda saqlanmoqda. Akkaunt ma’lumotlarini oching, tekshiring —
          va faqat shundan keyin bitimni tasdiqlang.
        </p>
        {status.orderId && (
          <Link
            href={`/kabinet/buyurtma/${status.orderId}`}
            className="btn-accent mt-6"
          >
            Buyurtmani ochish
          </Link>
        )}
      </div>
    );
  }

  if (status.status === "expired" || status.status === "cancelled") {
    return (
      <div className="surface p-6 sm:p-8">
        <Notice tone="warn">
          To‘lov muddati tugadi yoki bekor qilindi. Bandlik bekor qilindi — pul
          o‘tkazilmagan bo‘lsa, hech narsa yechilmaydi. Pul o‘tkazgan bo‘lsangiz,
          qayta to‘lamang va buyurtma raqami bilan yordam xizmatiga yozing.
        </Notice>
        {status.productId && (
          <Link href={`/sotib-olish/${status.productId}`} className="btn-accent mt-5">
            Qayta to‘lash
          </Link>
        )}
        <Link href="/katalog" className="btn-ghost ml-2 mt-5">
          Katalogga qaytish
        </Link>
        <p className="mt-4 break-all font-mono text-xs text-muted">
          Buyurtma: {transactionId}
        </p>
      </div>
    );
  }

  if (status.status !== "pending_payment") {
    return (
      <div className="surface p-6 sm:p-8">
        <Notice tone="warn">
          Bu to‘lov hozir faol emas. Pul o‘tkazgan bo‘lsangiz, qayta to‘lamang —
          buyurtma raqami bilan yordam xizmatiga yozing.
        </Notice>
        <Link href="/katalog" className="btn-ghost mt-5">
          Katalogga qaytish
        </Link>
        <a
          href="https://t.me/bitimax_admin"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost ml-2 mt-5"
        >
          Yordam
        </a>
        <p className="mt-4 break-all font-mono text-xs text-muted">
          Buyurtma: {transactionId}
        </p>
      </div>
    );
  }

  // HamyonAPI: the exact requested amount (price + a few so'm). SMS: the unique matching amount.
  const payAmount =
    status.paymentProvider === "hamyon"
      ? status.paymentAmount ?? status.uniqueAmount
      : status.uniqueAmount;
  const extra = payAmount - (status.basePrice ?? payAmount);

  return (
    <div className="space-y-4">
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-faint">
              Mahsulot
            </p>
            <p className="mt-1 truncate font-semibold text-ink">
              {status.title}
            </p>
          </div>
          <div className="shrink-0 rounded-lg bg-raised px-3 py-2 text-center">
            <p className="text-xs text-faint">Qoldi</p>
            <p className="text-ink">
              <Countdown to={status.expireAt} onDone={load} />
            </p>
          </div>
        </div>
      </div>

      <div className="surface p-5 sm:p-6">
        <p className="text-xs uppercase tracking-wider text-faint">
          Aynan shu summani o‘tkazing
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="tnum font-mono text-3xl font-bold text-ink">
            {payAmount}
          </p>
          <CopyButton value={String(payAmount)} name="summa" />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-warn">
          Summaning oxirgi raqamlari aynan sizning buyurtmangizni aniqlaydi.
          Boshqa summa o‘tkazsangiz, to‘lov avtomatik tanilmaydi.
          {extra > 0 && (
            <> Narx {formatUzs(status.basePrice ?? 0)}; {extra} so‘m qo‘shimcha
            to‘lovni aniqlash uchun kerak.</>
          )}
        </p>
      </div>

      {status.card ? (
        <div className="surface p-5 sm:p-6">
          <p className="text-xs uppercase tracking-wider text-faint">Karta</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="tnum font-mono text-xl font-semibold tracking-wide text-ink">
              {status.card.number.replace(/(.{4})/g, "$1 ").trim()}
            </p>
            <CopyButton value={status.card.number} name="karta raqami" />
          </div>
          <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
            {status.card.holder && <Row label="Egasi" value={status.card.holder} />}
            {status.card.bank && <Row label="Bank" value={status.card.bank} />}
            <Row
              label="Muddat"
              value={`${formatDateTime(status.expireAt)} gacha`}
            />
          </dl>
        </div>
      ) : (
        <Notice tone="warn">
          To‘lov kartasi sozlanmagan — administrator bilan bog‘laning.
        </Notice>
      )}

      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-raised px-4 py-3 text-sm text-muted">
        <Spinner size={16} />
        To‘lov kutilmoqda — pul tushishi bilan bu sahifa o‘zi
        yangilanadi.
      </div>

      <p className="text-xs leading-relaxed text-faint">
        Vaqt tugasa bandlik bekor bo‘ladi va sizga xabar beramiz. Pulingiz
        o‘tkazilmagan bo‘lsa — xavfsiz; kechikib o‘tkazilgan to‘lov esa
        yo‘qolmaydi, administrator qo‘lda hal qiladi.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-faint">{label}</dt>
      <dd className="text-right text-muted">{value}</dd>
    </div>
  );
}
