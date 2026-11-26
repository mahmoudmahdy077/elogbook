'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  url: string;
  label: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary';
  confirmMessage?: string;
}

/**
 * Posts to a case action route and stays on the page. The previous markup used
 * native <form method="POST"> to JSON routes, so the browser navigated the user
 * to the raw JSON response instead of showing a result.
 */
export default function CaseActionButton({
  url,
  label,
  pendingLabel = 'Working…',
  variant = 'primary',
  confirmMessage,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? 'That action could not be completed.');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const styles =
    variant === 'primary'
      ? 'rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-text-on-primary hover:bg-primary-hover'
      : 'rounded-full border border-primary px-4 py-2.5 text-sm font-medium text-fg-primary hover:bg-primary/10';

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`${styles} transition-colors disabled:opacity-50`}
      >
        {busy ? pendingLabel : label}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-fg-danger">{error}</p> : null}
    </div>
  );
}
