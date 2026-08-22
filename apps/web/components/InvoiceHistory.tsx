'use client';

import { useCallback, useEffect, useState } from 'react';

interface Invoice {
  id: string;
  number?: string | null;
  amount_due: number;
  currency: string;
  status: string;
  created: number;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}

/** Stripe invoice history for the tenant, loaded from the invoices API
 *  (which proxies the list-invoices edge function). */
export default function InvoiceHistory() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('invoices', { cache: 'no-store' });
      const data = (await res.json()) as { invoices?: Invoice[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInvoices(data.invoices ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-2">Invoice History</h2>
        <p className="text-sm text-danger">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 px-4 py-1.5 rounded-full border border-border text-sm font-medium text-text-secondary hover:bg-backdrop transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (invoices === null) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-3">Invoice History</h2>
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
      <h2 className="text-lg font-semibold mb-3">Invoice History</h2>
      {invoices.length === 0 ? (
        <p className="text-sm text-text-muted">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {invoices.map((inv) => {
            const date = new Date(inv.created * 1000);
            const paid = inv.status === 'paid';
            return (
              <li key={inv.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-sm font-medium text-text-primary block">
                    {inv.number || inv.id}
                  </span>
                  <span className="text-xs text-text-muted">{date.toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    paid
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}>
                    {paid ? 'Paid' : inv.status}
                  </span>
                  <span className="text-sm font-semibold text-text-primary tabular-nums">
                    {(inv.amount_due / 100).toFixed(2)} {inv.currency.toUpperCase()}
                  </span>
                  {inv.hosted_invoice_url && (
                    <a
                      href={inv.hosted_invoice_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary hover:opacity-80 transition-opacity"
                    >
                      View
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
