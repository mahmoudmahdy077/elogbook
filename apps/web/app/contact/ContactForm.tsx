'use client';

import { useState, type FormEvent } from 'react';

type State = 'idle' | 'sending' | 'sent' | 'error';

/**
 * The contact form used to be a native `method="POST"` form pointed at a JSON
 * API, so every submission navigated the visitor to `{"error":"Invalid JSON"}`.
 * It now posts with fetch and reports the result in place.
 */
export default function ContactForm() {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState('sending');
    setError('');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          institution: String(form.get('institution') ?? ''),
          message: String(form.get('message') ?? ''),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? 'Could not send your message. Please try again.');
        setState('error');
        return;
      }
      setState('sent');
    } catch {
      setError('Network error. Check your connection and try again.');
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="panel p-6 text-center sm:p-8" role="status">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-approved/20 bg-approved/10 text-fg-approved">
          <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Message sent</h2>
        <p className="mt-2 text-sm text-text-muted">
          Thanks — we reply within one business day. For anything urgent, email{' '}
          <a href="mailto:sales@elogbook.app" className="text-fg-primary underline">sales@elogbook.app</a>.
        </p>
      </div>
    );
  }

  const fieldClass =
    'w-full px-4 py-3 rounded-xl bg-surface-solid border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-[rgba(0,102,214,0.12)] text-[15px] transition-colors';

  return (
    <form onSubmit={handleSubmit} className="panel p-6 sm:p-8" noValidate>
      <h2 className="text-lg font-heading font-semibold mb-4">Send us a message</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-1">Name</label>
          <input id="name" name="name" type="text" required autoComplete="name" className={fieldClass} placeholder="Dr. Jane Smith" />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className={fieldClass} placeholder="jane@hospital.org" />
        </div>
        <div>
          <label htmlFor="institution" className="block text-sm font-medium text-text-primary mb-1">
            Institution <span className="font-normal text-text-muted">(optional)</span>
          </label>
          <input id="institution" name="institution" type="text" autoComplete="organization" className={fieldClass} placeholder="City Hospital" />
        </div>
        <div>
          <label htmlFor="message" className="block text-sm font-medium text-text-primary mb-1">Message</label>
          <textarea id="message" name="message" required rows={4} className={`${fieldClass} resize-none`} placeholder="Tell us about your needs…" />
        </div>

        {state === 'error' ? (
          <p role="alert" className="text-sm text-fg-danger">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={state === 'sending'}
          className="w-full min-h-[44px] py-3 rounded-full bg-primary text-text-on-primary font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {state === 'sending' ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  );
}
