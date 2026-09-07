import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import ErrorBoundary from '@/components/ErrorBoundary';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Denied({ reason }: { reason: string }) {
  return (
    <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface-solid border border-border rounded-2xl p-6 sm:p-8 text-center space-y-3">
        <h1 className="text-lg font-heading font-semibold text-text-primary">Platform access required</h1>
        <p className="text-sm text-text-muted">{reason}</p>
        <a href="/login" className="inline-block text-sm text-primary hover:underline">
          Back to sign-in
        </a>
      </div>
    </div>
  );
}

/**
 * Platform operator area (T17). Tenant role labels confer nothing here:
 * only the platform_admins registry (active) at AAL2 passes. Deliberately
 * outside (authenticated)/[tenant] so no tenant shell, nav, or slug logic
 * applies. Denials render a generic page (no existence oracle).
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const auth = await requirePlatformAdmin(supabase);
  if (!auth.ok) {
    return (
      <ErrorBoundary>
        <Denied reason="This area is restricted to platform operators." />
      </ErrorBoundary>
    );
  }

  return (
    <div className="min-h-dvh bg-backdrop text-text-primary">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <nav aria-label="Platform" className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-8">
          <span className="text-sm font-semibold" data-testid="platform-nav">
            Platform operations
          </span>
          <span className="font-mono text-xs text-text-muted">operator console</span>
        </nav>
      </header>
      <main className="mx-auto max-w-[1200px] px-8 py-8">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
