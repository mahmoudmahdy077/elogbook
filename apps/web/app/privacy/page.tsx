import Link from 'next/link';
import { APP_NAME } from '@elogbook/shared';

export const metadata = {
  title: `Privacy — ${APP_NAME}`,
  description: 'What E-Logbook stores, who can see it, and how long it is kept.',
};

const UPDATED = '26 November 2026';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-16">
        <p className="font-mono text-xs uppercase tracking-wide text-text-muted">Legal</p>
        <h1 className="mt-2 text-4xl font-heading font-bold">Privacy</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated {UPDATED}</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-text-secondary">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Who is responsible</h2>
            <p>
              Your hospital, training program or institution is the data controller for the
              logbook records you create. {APP_NAME} provides the software. If you are a resident,
              your program administrator controls your account and can see the entries and
              evaluations attached to it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">What is stored</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Account details: name, email, role, specialty, institution.</li>
              <li>
                Logbook entries: case date, template, the fields your program configured, and your
                accreditation mappings.
              </li>
              <li>
                Patient identifiers only when you choose identified mode. In de-identified mode the
                medical record number is hashed on the server and the plain value is not stored.
              </li>
              <li>Supervisor comments, evaluations, goals, duty hours, reflections and consents.</li>
              <li>Audit records: who changed what and when.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Who can see it</h2>
            <p>
              Access is enforced in the database, not only in the interface. You see your own
              entries; supervisors and program directors see the entries of the residents they
              supervise; platform operators can manage tenants but do not have standing access to
              clinical records. Every privileged action is written to the audit trail.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Where it is processed</h2>
            <p>
              Data is stored in a Supabase (PostgreSQL) project and the web application runs on
              Vercel. Payments, when enabled by your institution, are handled by the payment
              provider configured by that institution. Error reports are sent to Sentry with
              patient fields removed before transmission. We do not sell data and we do not use it
              to train models.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">How long it is kept</h2>
            <p>
              Your institution sets a retention period (default seven years, configurable in Admin →
              Retention). After that period records are soft-deleted and purged by a scheduled job.
              Audit records are append-only and cannot be edited.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Your choices</h2>
            <p>
              You can export your cases as CSV and request a copy or deletion of your account
              through your program administrator. Consent for optional analytics is asked
              separately and can be changed at any time in Consent.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold text-text-primary">Contact</h2>
            <p>
              Privacy questions: <a className="text-fg-primary underline" href="mailto:privacy@elogbook.app">privacy@elogbook.app</a>.
              Security reports: <a className="text-fg-primary underline" href="mailto:security@elogbook.app">security@elogbook.app</a>.
            </p>
          </section>

          <p className="rounded-lg border border-border bg-surface-solid p-4 text-xs text-text-muted">
            This page describes how the service currently operates. It is a working policy for the
            pilot and is reviewed with counsel before general availability.
          </p>
        </div>

        <nav className="mt-12 flex gap-4 text-sm">
          <Link href="/" className="text-fg-primary underline">Home</Link>
          <Link href="/terms" className="text-fg-primary underline">Terms</Link>
          <Link href="/contact" className="text-fg-primary underline">Contact</Link>
        </nav>
      </main>
    </div>
  );
}
