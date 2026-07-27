import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME } from '@elogbook/shared';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Redirect authenticated users to their dashboard
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenants!inner(slug)')
        .eq('user_id', user.id)
        .single();
      const slug = (profile?.tenants as { slug: string } | null)?.slug;
      if (slug) redirect(`/${slug}/dashboard`);
    }
  } catch {
    // Not authenticated — show landing page
  }

  return (
    <div className="min-h-screen bg-backdrop text-text-primary flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-20">
        <nav className="mb-8">
          <Link href="/pricing" className="text-sm text-text-muted hover:text-text-primary transition-colors underline underline-offset-2">
            Pricing
          </Link>
        </nav>
        <div className="max-w-3xl text-center">
          <h1 className="text-4xl font-heading font-bold mb-4 text-text-primary">
{APP_NAME}
          </h1>
          <p className="text-lg text-text-secondary mb-2">
            The enterprise-grade electronic logbook for medical residents.
          </p>
          <p className="text-base text-text-muted mb-8">
            Log procedures, map to accreditation milestones, and receive
            supervisor verifications — securely, offline-ready, and
            HIPAA-compliant.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="px-6 py-3 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow"
            >
              Sign up free
            </Link>
            <Link
              href="/login"
              className="px-6 py-3 rounded-lg border border-border text-text-primary font-medium text-sm hover:bg-surface-elevated transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>

      <section className="px-4 pb-20">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { title: 'Procedure Logging', desc: 'Multi-step wizard with de-identification, template-driven fields, and offline support.' },
            { title: 'Accreditation Mapping', desc: 'Map cases to ACGME, SCFHS, GMC, and custom frameworks with milestone tracking.' },
            { title: 'Supervisor Verification', desc: 'Atomic approve/reject workflow with audit trail and concurrent-safe locking.' },
          ].map((f) => (
            <div key={f.title} className="panel p-6">
              <h3 className="text-lg font-heading font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-text-muted">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-4 py-6 border-t border-border text-center">
        <p className="text-xs text-text-muted">
          &copy; 2026 {APP_NAME}. Built for medical residents.
        </p>
      </footer>
    </div>
  );
}
