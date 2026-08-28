import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { APP_NAME } from '@elogbook/shared';
import { HashLab, CustodyDemo, TrustVault, SessionLogbookEntry } from '@/components/landing/LandingIslands';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${APP_NAME} — Every case. Sealed.`,
  description:
    'Electronic logbook for medical residents: offline logging with instant de-identification, supervisor sign-off, and an immutable audit trail behind every entry.',
};

interface PlanFallback {
  name: string;
  blurb: string;
}

/** Rendered only when subscription_plans is empty/unavailable — graceful degrade per master-direction. */
const PLAN_FALLBACK: PlanFallback[] = [
  { name: 'Free', blurb: 'Log & sync core for individual residents' },
  { name: 'Institution', blurb: 'Roles, exports, SSO for programs' },
];

const CHAPTERS = ['01', '02', '03', '04'] as const;
void CHAPTERS; // reserved: desktop gutter rail in polish pass

export default async function HomePage() {
  // Authenticated visitors never see marketing — straight to their tenant dashboard.
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenants!inner(slug)')
        .eq('user_id', user.id)
        .single();
      const slug = (profile?.tenants as unknown as { slug: string } | null)?.slug;
      if (slug) redirect(`/${slug}/dashboard`);
    }
  } catch {
    // Not authenticated — render landing.
  }

  // Live plans read; empty table falls back to shared-constant tier strip.
  let plans: PlanFallback[] = PLAN_FALLBACK;
  let plansLive = false;
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from('subscription_plans')
      .select('name, slug')
      .order('price_monthly', { ascending: true });
    if (data && data.length > 0) {
      plans = data.map((p) => ({ name: p.name, blurb: '' }));
      plansLive = true;
    }
  } catch {
    plans = PLAN_FALLBACK;
  }

  return (
    <div className="min-h-screen bg-backdrop text-text-secondary">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface-solid focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>

      {/* 0 · NAV */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface backdrop-blur">
        <nav aria-label="Primary" className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-8 max-md:px-6 max-sm:px-4">
          <Link href="/" className="text-sm font-semibold text-text-primary" data-testid="nav-logo">
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex min-h-[44px] items-center px-3 text-sm text-text-secondary underline-offset-2 hover:text-text-primary hover:underline">
              Sign in
            </Link>
            <Link href="/signup" className="inline-flex min-h-[44px] items-center rounded-8 bg-primary px-4 text-sm font-medium text-text-on-primary transition-transform active:scale-[0.97] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Start free
            </Link>
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ACT 1 · ARRIVAL — hero */}
        <section aria-labelledby="hero-h" className="relative mx-auto max-w-[1200px] px-8 pb-24 pt-32 max-md:px-6 max-md:pt-24 max-sm:px-4" data-testid="hero">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">Electronic logbook · SCFHS · ACGME · GMC</p>
          <h1 id="hero-h" className="mt-4 max-w-[14ch] text-heading font-heading font-bold leading-[1.05] tracking-[-0.03em] text-text-primary max-lg:text-5xl text-7xl">
            Every case. Sealed.
          </h1>
          <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-text-secondary">
            Scattered records, retyped exports, lost evenings — paperwork that cannot survive an audit window.{' '}
            Log offline, de-identify instantly, and put supervisor sign-off behind every entry.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup?role=resident" className="inline-flex min-h-[44px] items-center rounded-8 bg-primary px-5 text-sm font-medium text-text-on-primary transition-transform active:scale-[0.97] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="hero-cta">
              Start logging free
            </Link>
            <a href="#demo" className="inline-flex min-h-[44px] items-center rounded-8 border border-border-active px-5 text-sm font-medium text-text-secondary transition-colors hover:border-primary-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              See verification work
            </a>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 lg:col-start-1">{/* whitespace held deliberately (≥50% hero canvas at ≥1280) */}</div>
            <div className="lg:col-span-5 lg:col-start-8">
              <HashLab />
            </div>
          </div>
        </section>

        {/* ACT 1→2 · METHOD — verbs */}
        <section aria-labelledby="verbs-h" className="border-t border-divider" data-custody-section id="method" data-testid="verbs">
          <div className="mx-auto max-w-[1200px] px-8 py-24 max-md:px-6 max-sm:px-4">
            <span aria-hidden className="mb-2 block font-mono text-xs tabular-nums text-text-muted lg:hidden">01</span>
            <h2 id="verbs-h" className="text-3xl font-semibold tracking-tight text-text-primary">Log. Map. Sign.</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <article className="rounded-14 border border-border bg-surface p-6 backdrop-blur">
                <h3 className="text-base font-semibold text-text-primary">Log.</h3>
                <p className="mt-2 text-sm leading-relaxed">Offline capture survives the basement, the elevator, the dead zone. Sync returns; nothing is retyped.</p>
              </article>
              <article className="rounded-14 border border-border bg-surface p-6 backdrop-blur">
                <h3 className="text-base font-semibold text-text-primary">Map.</h3>
                <p className="mt-2 text-sm leading-relaxed">Cases align to SCFHS, ACGME, and GMC requirements as you work — coverage visible before anyone asks.</p>
              </article>
              <article className="rounded-14 border border-border bg-surface p-6 backdrop-blur">
                <h3 className="text-base font-semibold text-text-primary">Sign.</h3>
                <p className="mt-2 text-sm leading-relaxed">Supervisors approve with one tap. Rejections come back with reasons, not silence.</p>
              </article>
            </div>
          </div>
        </section>

        {/* ACT 2·3 HINGE — two-click demo */}
        <section aria-labelledby="demo-h" id="demo" data-custody-section data-testid="demo-section" className="scroll-mt-20">
          <div className="mx-auto max-w-[1200px] px-8 py-24 max-md:px-6 max-sm:px-4">
            <span aria-hidden className="mb-2 block font-mono text-xs tabular-nums text-text-muted lg:hidden">01</span>
            <h2 id="demo-h" className="text-3xl font-semibold tracking-tight text-text-primary">Try the review queue.</h2>
            <p className="mt-2 text-sm text-text-muted">Two sample cases. Your two clicks. A real audit artifact.</p>
            <div className="mt-10">
              <CustodyDemo />
            </div>
          </div>
        </section>

        {/* ACT 3 · EVIDENCE — vault + milestones */}
        <section aria-labelledby="vault-h" id="evidence" data-custody-section data-testid="vault-section" className="border-t border-divider">
          <div className="mx-auto max-w-[1200px] px-8 py-24 max-md:px-6 max-sm:px-4">
            <span aria-hidden className="mb-2 block font-mono text-xs tabular-nums text-text-muted lg:hidden">02</span>
            <h2 id="vault-h" className="text-3xl font-semibold tracking-tight text-text-primary">Security, stated plainly.</h2>
            <p className="mt-2 max-w-[52ch] text-sm text-text-muted">The logbook that defends your work — stated plainly:</p>
            <div className="mt-10">
              <TrustVault />
            </div>
            <div className="mt-16 border-t-2 border-primary pt-8">
              <h3 className="text-xl font-semibold text-text-primary">Built for your framework.</h3>
              <p className="mt-2 text-sm text-text-muted">Coverage mapped to your framework, readable at a glance.</p>
              <ul className="mt-6 divide-y divide-divider border-y border-divider">
                {['SCFHS — logged procedures map to specialty requirement lists', 'ACGME — case categories align with review committee formatting', 'GMC — export structure supports curriculum mapping evidence'].map((row) => (
                  <li key={row} className="py-3 text-sm tabular-nums">{row}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ACT 4 · COMMITMENT */}
        <section aria-labelledby="choose-h" id="choose" data-custody-section data-testid="choose-section" className="border-t border-divider">
          <div className="mx-auto max-w-[720px] px-8 py-24 text-center max-md:px-6 max-sm:px-4">
            <span aria-hidden className="mb-2 block font-mono text-xs tabular-nums text-text-muted lg:hidden">04</span>
            <h2 id="choose-h" className="text-3xl font-semibold tracking-tight text-text-primary">Start where you stand.</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <article className="rounded-14 border border-border bg-surface p-6 text-left backdrop-blur">
                <h3 className="text-base font-semibold text-text-primary">I&apos;m a resident</h3>
                <p className="mt-2 text-sm">Offline capture that syncs when signal returns, de-identified before it leaves your hands.</p>
                <Link href="/signup?role=resident" className="mt-4 inline-flex min-h-[44px] items-center rounded-8 bg-primary px-4 text-sm font-medium text-text-on-primary transition-transform active:scale-[0.97] hover:bg-primary-hover">
                  Create account
                </Link>
              </article>
              <article className="rounded-14 border border-border bg-surface p-6 text-left backdrop-blur">
                <h3 className="text-base font-semibold text-text-primary">I direct a program</h3>
                <p className="mt-2 text-sm">Immutable trails, milestone coverage, and exports your accreditation reviewers accept without follow-up.</p>
                <Link href="/signup?role=director" className="mt-4 inline-flex min-h-[44px] items-center rounded-8 border border-border-active px-4 text-sm font-medium text-text-secondary hover:border-primary-glow">
                  See controls
                </Link>
              </article>
            </div>

            {/* Pricing strip — live rows or graceful fallback */}
            <div className="mt-12 rounded-14 border border-border bg-surface-solid p-5" data-testid="pricing-strip">
              <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm">
                {plans.map((p) => (
                  <li key={p.name}>
                    <span className="font-medium text-text-primary">{p.name}</span>
                    {p.blurb ? <span className="ml-2 text-text-muted">{p.blurb}</span> : null}
                    {!plansLive && p.name === 'Institution' ? (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-text-muted">coming</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Link href="/pricing" className="mt-3 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
                See plans →
              </Link>
            </div>

            <p className="mt-12 font-mono text-xs tabular-nums text-text-muted" data-testid="attestation">
              verified locally · your browser computes every digest on this page
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-8 py-8 text-sm max-md:px-6 max-sm:px-4">
          <p className="text-text-muted">{APP_NAME}</p>
          <nav aria-label="Footer" className="flex gap-5">
            <Link href="/pricing" className="text-text-secondary underline-offset-2 hover:underline">Pricing</Link>
            <Link href="/contact" className="text-text-secondary underline-offset-2 hover:underline">Contact</Link>
          </nav>
        </div>
      </footer>

      {/* Hidden CTA — fires once/session via exit-intent, score gate, or Shift+. ; keyboard reachable */}
      <SessionLogbookEntry sampleExportPath="/elogbook-sample-export.txt" />
    </div>
  );
}
