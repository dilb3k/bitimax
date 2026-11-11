'use client';

import { Icon } from "@/components/Icon";
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/cabinet';
import { formatUzs } from '@/lib/api';
import { Notice, SubmitButton } from './ui';

type Deal = Awaited<ReturnType<typeof api.lookupDeal>>['deal'];

/**
 * Redeeming a seller's private deal code — the web twin of the bot's code wizard.
 *
 * The code is the only thing protecting a private deal, so guessing is rate-limited on the
 * server (ten tries per ten minutes) rather than by anything this component does. What the UI
 * contributes is normalising whatever the buyer pastes — spaces, dashes, lowercase — into the
 * stored form, so a valid code never fails for cosmetic reasons and burns an attempt.
 */
export function DealCodePanel() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [deal, setDeal] = useState<Deal | null>(null);
  const [policy, setPolicy] = useState('');
  const [busy, setBusy] = useState<'lookup' | 'buy' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onCodeChange(value: string) {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
  }

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    setBusy('lookup');
    setError(null);
    try {
      const result = await api.lookupDeal(code);
      setDeal(result.deal);
      setPolicy(result.refundPolicy);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Juda ko‘p urinish. Bir necha daqiqadan so‘ng qayta urinib ko‘ring.');
      } else if (!(err instanceof ApiError) || err.status !== 401) {
        setError(err?.message || 'Kodni tekshirib bo‘lmadi');
      }
    } finally {
      setBusy(null);
    }
  }

  async function buy() {
    if (!deal) return;
    setBusy('buy');
    setError(null);
    try {
      const payment = await api.buy(deal.id, code);
      router.replace(`/tolov/${payment.transactionId}`);
    } catch (err: any) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        setError(err?.message || 'Bitimni ochib bo‘lmadi');
      }
      setBusy(null);
    }
  }

  if (deal) {
    return (
      <div className="surface p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wider text-faint">Bitim topildi</p>
        <h2 className="mt-1 text-xl font-bold leading-snug text-ink">{deal.title}</h2>
        <p className="tnum mt-3 text-3xl font-bold text-ink">{formatUzs(deal.price)}</p>

        {deal.seller && (
          <p className="mt-2 text-sm text-muted">
            Sotuvchi: @{deal.seller.username || 'noma’lum'}{' '}
            <span className="text-faint">
              {deal.seller.rating !== null
                ? `· Baho: ${deal.seller.rating.toFixed(1)}/5 (${deal.seller.ratingCount})`
                : '· yangi sotuvchi'}
            </span>
          </p>
        )}

        <div className="mt-5 rounded-lg bg-raised p-4 text-sm leading-relaxed text-muted">
          <Icon name="shield" className="mr-1 inline-block align-text-bottom" /> Pulingiz sotuvchiga darhol o‘tmaydi. Avval akkauntni tekshirasiz, keyin
          tasdiqlaysiz. Muammo bo‘lsa — siyosat bo‘yicha qaytariladi.
          {policy && <span className="mt-2 block whitespace-pre-line text-xs text-faint">{policy}</span>}
        </div>

        {error && (
          <div className="mt-4">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <SubmitButton busy={busy === 'buy'} onClick={buy} className="btn-accent flex-1">
            To‘lovga o‘tish
          </SubmitButton>
          <button
            type="button"
            onClick={() => {
              setDeal(null);
              setCode('');
            }}
            className="btn-ghost flex-1"
          >
            Boshqa kod
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={lookup} className="surface p-6 sm:p-8">
      <label htmlFor="deal-code" className="mb-2 block text-sm font-medium text-ink">
        Sotuvchi bergan 8 belgili kod
      </label>
      <input
        id="deal-code"
        className="field tnum text-center font-mono text-2xl tracking-[0.2em]"
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        placeholder="ABCD-2345"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        required
      />

      {error && (
        <div className="mt-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      <SubmitButton
        busy={busy === 'lookup'}
        type="submit"
        className="btn-accent mt-5 w-full"
        disabled={code.replace(/-/g, '').length !== 8}
      >
        Bitimni ochish
      </SubmitButton>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Kod faqat siz va sotuvchiga ma’lum. Bitim katalogda ko‘rinmaydi.
      </p>
    </form>
  );
}
