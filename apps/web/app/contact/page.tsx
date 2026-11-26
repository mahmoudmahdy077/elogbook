import { APP_NAME } from '@elogbook/shared';
import ContactForm from './ContactForm';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main id="main-content" className="max-w-xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-heading font-bold text-center mb-2">Contact Sales</h1>
        <p className="text-center text-text-secondary mb-4">
          Interested in SSO, SCIM, BAA, or enterprise pricing?
        </p>
        <p className="text-center text-sm text-text-muted mb-8">
          Email us directly at{' '}
          <a href="mailto:sales@elogbook.app" className="text-fg-primary underline font-medium">
            sales@elogbook.app
          </a>
        </p>

        <ContactForm />

        <p className="text-center text-xs text-text-muted mt-8">
          <Link href="/" className="text-fg-primary underline">{APP_NAME}</Link>
          <span className="mx-2 text-text-muted">·</span>
          <Link href="/privacy" className="text-fg-primary underline">Privacy</Link>
          <span className="mx-2 text-text-muted">·</span>
          <Link href="/terms" className="text-fg-primary underline">Terms</Link>
        </p>
      </main>
    </div>
  );
}
