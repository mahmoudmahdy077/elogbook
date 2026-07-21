import { APP_NAME } from '@elogbook/shared';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main className="max-w-xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-heading font-bold text-center mb-2">Contact Sales</h1>
        <p className="text-center text-text-secondary mb-4">
          Interested in SSO, SCIM, BAA, or enterprise pricing?
        </p>
        <p className="text-center text-sm text-text-muted mb-8">
          Email us directly at{' '}
          <a href="mailto:sales@elogbook.app" className="text-primary underline font-medium">
            sales@elogbook.app
          </a>
        </p>

        <div className="panel p-6 sm:p-8">
          <h2 className="text-lg font-heading font-semibold mb-4">Send us a message</h2>
          <form action="/api/contact" method="POST" className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-1">Name</label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-black placeholder:text-[#8E8E93]/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-[rgba(0,122,255,0.12)] text-[15px] transition-colors"
                placeholder="Dr. Jane Smith"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-1">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-black placeholder:text-[#8E8E93]/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-[rgba(0,122,255,0.12)] text-[15px] transition-colors"
                placeholder="jane@hospital.org"
              />
            </div>
            <div>
              <label htmlFor="institution" className="block text-sm font-medium text-text-primary mb-1">Institution</label>
              <input
                id="institution"
                name="institution"
                type="text"
                className="w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-black placeholder:text-[#8E8E93]/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-[rgba(0,122,255,0.12)] text-[15px] transition-colors"
                placeholder="City Hospital"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-text-primary mb-1">Message</label>
              <textarea
                id="message"
                name="message"
                required
                rows={4}
                className="w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-black placeholder:text-[#8E8E93]/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-[rgba(0,122,255,0.12)] text-[15px] transition-colors resize-none"
                placeholder="Tell us about your needs..."
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 rounded-full bg-primary text-white font-medium text-sm hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Send message
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-muted mt-8">
          <Link href="/" className="text-primary underline">{APP_NAME}</Link>
        </p>
      </main>
    </div>
  );
}
