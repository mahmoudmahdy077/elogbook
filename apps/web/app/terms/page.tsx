import Link from 'next/link';
import { APP_NAME } from '@elogbook/shared';

export const metadata = {
  title: `Terms — ${APP_NAME}`,
  description: 'The terms that apply to using E-Logbook.',
};

const UPDATED = '26 November 2026';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-16">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">Legal</p>
        <h1 className="mt-2 text-4xl font-heading font-bold">Terms of use</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated {UPDATED}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-text-secondary">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">The service</h2>
            <p>
              {APP_NAME} is a logbook for surgical and medical training: case capture, supervisor
              sign-off, evaluations, goals, duty hours and accreditation exports. Your institution
              decides who gets an account and which roles they hold.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Your account</h2>
            <p>
              Keep your password private and turn on multi-factor authentication. You are
              responsible for entries made under your account. Tell your administrator immediately
              if you believe your account was used by someone else. Accounts can be deactivated by
              an administrator; deactivation blocks sign-in.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Clinical responsibility</h2>
            <p>
              The logbook records training activity. It is not a medical record of care, does not
              provide clinical advice, and must not be used as the source of truth for patient
              treatment. AI-assisted summaries are optional, operate only on de-identified entries,
              and are never a substitute for supervision.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Acceptable use</h2>
            <p>
              Do not enter data you are not authorised to hold, attempt to access another person&apos;s
              records, probe the service for vulnerabilities without written permission, or use it to
              make automated decisions about patients. Report suspected security issues to{' '}
              <a className="text-fg-primary underline" href="mailto:security@elogbook.app">security@elogbook.app</a>.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Plans and payment</h2>
            <p>
              Individual accounts can use the free plan. Paid plans are billed to the institution
              through the payment provider configured by that institution. Cancelling stops renewal
              at the end of the current period; data remains exportable during the notice period.
              Prices are shown on the pricing page.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Availability and changes</h2>
            <p>
              We aim to keep the service available but do not guarantee uninterrupted access.
              Maintenance, security fixes and feature changes may interrupt it. Material changes to
              these terms are announced to institution administrators before they take effect.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Ending use</h2>
            <p>
              You may stop using the service at any time. Your institution can export its data
              before an account or tenant is closed. Audit records required for accreditation or
              law are retained for the configured retention period.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Contact</h2>
            <p>
              Questions about these terms: <a className="text-fg-primary underline" href="mailto:legal@elogbook.app">legal@elogbook.app</a>.
            </p>
          </section>

          <p className="rounded-lg border border-border bg-surface-solid p-4 text-xs text-text-muted">
            These terms describe the current pilot service and are reviewed with counsel before
            general availability.
          </p>
        </div>

        <nav className="mt-12 flex gap-4 text-sm">
          <Link href="/" className="text-fg-primary underline">Home</Link>
          <Link href="/privacy" className="text-fg-primary underline">Privacy</Link>
          <Link href="/contact" className="text-fg-primary underline">Contact</Link>
        </nav>
      </main>
    </div>
  );
}
