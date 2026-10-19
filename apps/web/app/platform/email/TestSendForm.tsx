'use client';

import { useState } from 'react';
import ErrorDisplay from '@/components/ErrorDisplay';

/**
 * Platform test-send form. POSTs to the rate-limited
 * (`email-test:<ip>` 5/min) test route, which sends synchronously via
 * Resend primary + SMTP fallback and writes audit + email log rows.
 */
export default function TestSendForm() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('Platform test email');
  const [html, setHtml] = useState('<p>Platform test email.</p>');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    setError(null);
    setResult(null);
    if (!to.trim()) {
      setError('Recipient email is required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/platform/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject, html }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; via?: string; id?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(`Sent via ${data.via ?? 'unknown'} (${data.id ?? 'no id'})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-14 border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-text-primary mb-1">Test send</h2>
      <p className="text-xs text-text-muted mb-4">
        Synchronous Resend + SMTP failover send. Rate-limited to 5/min per IP and audited.
      </p>
      <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-test-to">
        To
      </label>
      <input
        id="email-test-to"
        type="email"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="operator@example.com"
        className="w-full rounded-lg border border-border bg-surface-solid px-3 py-2 text-sm text-text-primary mb-3"
      />
      <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-test-subject">
        Subject
      </label>
      <input
        id="email-test-subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={200}
        className="w-full rounded-lg border border-border bg-surface-solid px-3 py-2 text-sm text-text-primary mb-3"
      />
      <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-test-html">
        HTML
      </label>
      <textarea
        id="email-test-html"
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full font-mono text-xs rounded-lg border border-border bg-surface-solid p-3 text-text-primary"
      />
      <div className="mt-4">
        <button
          onClick={() => void send()}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send test email'}
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorDisplay message={error} />
        </div>
      )}
      {result && <p className="mt-3 text-sm text-success">{result}</p>}
    </div>
  );
}
