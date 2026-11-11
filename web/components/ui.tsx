'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The three states every data view owes the user — loading, empty, error — as one small kit,
 * so no screen in the cabinet can quietly render a blank rectangle when a request fails.
 */

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      role="status"
      aria-label="Yuklanmoqda"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity=".2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-muted">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="surface flex flex-col items-center gap-3 p-8 text-center" role="alert">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warn/10 text-warn">!</span>
      <p className="text-sm text-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost text-sm">
          Qaytadan urinish
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface flex flex-col items-center gap-3 p-10 text-center">
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm leading-relaxed text-muted">{hint}</p>}
      {action}
    </div>
  );
}

/** Inline, non-blocking notice. Errors from an action land here rather than in an alert(). */
export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const styles = {
    ok: 'border-ok/30 bg-ok/10 text-ok',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    info: 'border-line bg-raised text-muted',
  }[tone];

  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${styles}`} role="status">
      {children}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'accent' | 'muted'; children: React.ReactNode }) {
  const styles = {
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-warn/10 text-warn',
    accent: 'bg-accent-soft text-ink',
    muted: 'bg-raised text-muted',
  }[tone];
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${styles}`}>{children}</span>;
}

/** Button that shows its own in-flight state, so a slow request can't be double-submitted. */
export function SubmitButton({
  busy,
  children,
  className = 'btn-accent',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={busy || props.disabled} className={className}>
      {busy && <Spinner size={16} />}
      {children}
    </button>
  );
}

/**
 * Loads data once, exposes {data, error, loading, reload}. Deliberately tiny — the cabinet has
 * a dozen screens with the same shape and none of them need a data-fetching library.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const sequence = useRef(0);

  const run = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loader();
      if (alive.current && request === sequence.current) setData(result);
    } catch (err: any) {
      if (alive.current && request === sequence.current) setError(err?.message || 'Xatolik yuz berdi');
    } finally {
      if (alive.current && request === sequence.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, [run]);

  return { data, error, loading: loading && data === null, refreshing: loading, reload: run, setData };
}

/** Live "3:41 qoldi" for payment windows and auto-release deadlines. */
export function Countdown({ to, onDone }: { to: string; onDone?: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(to).getTime() - Date.now()));
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    let done = false;
    const tick = () => {
      const deadline = new Date(to).getTime();
      const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
      setLeft(remaining);
      if (remaining === 0 && !done) { done = true; onDoneRef.current?.(); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [to]);

  const totalSeconds = Math.floor(left / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <span className="tnum font-semibold">
      {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  );
}

/** Copy-to-clipboard control for card numbers, amounts and deal codes. */
export function CopyButton({ value, label = 'Nusxa olish', name }: { value: string; label?: string; name?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="min-h-[44px] rounded-md border border-line px-2.5 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-ink"
      aria-label={name ? `${label}: ${name}` : label}
    >
      <span aria-live="polite">{copyError ? 'Nusxalanmadi — matnni belgilang' : copied ? 'Nusxa olindi' : label}</span>
    </button>
  );
}

export { formatDateTime } from '@/lib/api';
