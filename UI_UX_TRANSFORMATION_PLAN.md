# E-Logbook UI/UX Enterprise Transformation Plan

> **For agentic workers:** Each task is self-contained with exact file paths, before/after code, and a DOUBLE-CHECK step. Execute tasks in order. If a task blocks you, stop and report — do NOT improvise.

**Generated:** 2026-06-30
**Goal:** Transform E-Logbook from a broken-layout prototype into a production enterprise medical SaaS UI — fixing the design system, layout, navigation, role-based UX, state management, accessibility, and onboarding.

**Architecture:** Next.js 16 App Router, Tailwind CSS v4, HeroUI v3, Framer Motion, dark theme (with light mode support).

---

## Phase Overview

| Phase | Theme | Tasks | Impact |
|-------|-------|-------|--------|
| U1 | Fix the design system foundation | U1.0–U1.5 | All colors, fonts, components render correctly |
| U2 | Fix layout, navigation, and identity | U2.0–U2.6 | Professional chrome, user identity, breadcrumbs |
| U3 | Fix the landing page and login | U3.0–U3.2 | First impression is enterprise-grade |
| U4 | Fix the dashboard and role-based UX | U4.0–U4.5 | Every role sees correct, useful data |
| U5 | Fix case form and approvals | U5.0–U5.5 | Core workflows are polished and safe |
| U6 | Fix all data pages (cases, goals, reports, billing, admin, audit) | U6.0–U6.8 | Every page is production-ready |
| U7 | Fix accessibility and responsive | U7.0–U7.5 | WCAG AA+ compliance, mobile works |
| U8 | Add onboarding and polish | U8.0–U8.3 | New users can get started without help |

---

## PHASE U1 — FIX THE DESIGN SYSTEM FOUNDATION

> **Why this is first:** ~15 screens use undefined HeroUI tokens (`text-default-500`, `bg-danger-50`, `border-divider`) that aren't in the Tailwind theme. These render as **invisible/no-op** — text with no color, backgrounds that don't appear, borders that don't show. Fixing the theme eliminates ~30 visible bugs at once.

### Task U1.0 — Add missing HeroUI color scales to Tailwind theme

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`

**Problem:** HeroUI components emit classes like `text-default-500`, `bg-default-100`, `border-divider`, `bg-danger-50`, `bg-success-50`, `text-success`, `text-danger`, `bg-warning`, `bg-danger`. These don't exist in `@theme` so Tailwind v4 doesn't generate them. Result: invisible text, missing backgrounds, missing borders across ~15 pages.

- [ ] **Step 1:** Read `apps/web/app/globals.css` fully. Find the `@theme` block (around line 5-50).

- [ ] **Step 2:** Add these missing color scales to the `@theme` block in `globals.css`. Add them AFTER the existing tokens, BEFORE the closing `}` of `@theme`:

```css
/* HeroUI semantic color scales — required for HeroUI components to render */
--color-default-50: #f8fafc;
--color-default-100: #f1f5f9;
--color-default-200: #e2e8f0;
--color-default-400: #94a3b8;
--color-default-500: #64748b;
--color-default-600: #475569;
--color-default-700: #334155;

--color-success-50: rgba(5, 150, 105, 0.1);
--color-success: #059669;
--color-success-glow: rgba(16, 185, 129, 0.45);

--color-warning-50: rgba(217, 119, 6, 0.1);
--color-warning: #d97706;
--color-warning-glow: rgba(245, 158, 11, 0.45);

--color-danger-50: rgba(220, 38, 38, 0.1);
--color-danger: #dc2626;
--color-danger-glow: rgba(239, 68, 68, 0.45);

--color-divider: rgba(99, 102, 241, 0.12);
```

- [ ] **Step 3:** Also add these to `tailwind.config.ts` in the `theme.extend.colors` object, after the existing colors:

```typescript
default: {
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
},
success: {
  50: 'rgba(5, 150, 105, 0.1)',
  DEFAULT: '#059669',
  glow: 'rgba(16, 185, 129, 0.45)',
},
warning: {
  50: 'rgba(217, 119, 6, 0.1)',
  DEFAULT: '#d97706',
  glow: 'rgba(245, 158, 11, 0.45)',
},
danger: {
  50: 'rgba(220, 38, 38, 0.1)',
  DEFAULT: '#dc2626',
  glow: 'rgba(239, 68, 68, 0.45)',
},
divider: 'rgba(99, 102, 241, 0.12)',
```

- [ ] **Step 4: DOUBLE-CHECK.** Run `pnpm --filter @elogbook/web build`. Expected: build succeeds. Then search for `text-default-500` in the generated `.next/static/css` — it should now appear (previously it was absent).

### Task U1.1 — Mount HeroUI Provider

**Files:**
- Modify: `apps/web/components/ClientProviders.tsx`

**Problem:** HeroUI compound components (Modal, Select, Table, Tabs, etc.) are used throughout the app but the HeroUI `Provider` is never mounted. This means overlay/focus/theme context is missing — modals may not trap focus, dropdowns may not close on outside click, theme tokens may not propagate.

- [ ] **Step 1:** Read `apps/web/components/ClientProviders.tsx`.

- [ ] **Step 2:** Replace the entire file with:

```tsx
'use client';

import { Provider as HeroUIProvider } from '@heroui/react';
import { ToastProvider } from './Toast';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider>
      <ToastProvider>{children}</ToastProvider>
    </HeroUIProvider>
  );
}
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web typecheck` → exit 0. `pnpm --filter @elogbook/web build` → succeeds.

### Task U1.2 — Fix the global-error page styling

**Files:**
- Modify: `apps/web/app/global-error.tsx`

**Problem:** The top-level error page renders bare unstyled HTML — `<h1>Something went wrong</h1>` with no CSS. This is the critical last-resort error page.

- [ ] **Step 1:** Read `apps/web/app/global-error.tsx`.

- [ ] **Step 2:** Replace the return JSX with a styled version using design tokens:

```tsx
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: '#060814', color: '#F1F5F9', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
          <div style={{ maxWidth: '28rem', width: '100%', backgroundColor: '#0F172A', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.15)', padding: '2rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#F1F5F9' }}>Something went wrong</h1>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
              An unexpected error occurred. The error has been reported. Please try refreshing the page.
            </p>
            {err && (
              <pre style={{ fontSize: '0.75rem', color: '#FCA5A5', backgroundColor: 'rgba(220,38,38,0.1)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1.5rem', overflow: 'auto' }}>
                {err.message}
              </pre>
            )}
            <button
              onClick={() => reset?.()}
              style={{ width: '100%', padding: '0.625rem', borderRadius: '8px', backgroundColor: '#0D9488', color: '#FFFFFF', fontSize: '0.875rem', fontWeight: 500, border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
```

Note: `global-error.tsx` cannot use Tailwind classes (it replaces the root layout), so inline styles with hardcoded token values are the correct pattern here.

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U1.3 — Define a typography scale

**Files:**
- Modify: `packages/shared/src/constants/design-tokens.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`

**Problem:** No `fontSize` tokens exist. Headings bounce between `text-xl`, `text-2xl`, `text-lg` ad-hoc with no rhythm. A medical app needs a consistent type scale.

- [ ] **Step 1:** Add a `fonts.sizes` object to `design-tokens.ts` after the existing `fonts` object:

```typescript
fonts: {
  heading: 'Outfit, sans-serif',
  body: 'Inter, Plus Jakarta Sans, sans-serif',
  mono: 'Geist Mono, JetBrains Mono, monospace',
  sizes: {
    xs: '0.75rem',   // 12px — labels, captions
    sm: '0.875rem',  // 14px — body small, table cells
    base: '1rem',    // 16px — body text
    lg: '1.125rem',  // 18px — emphasized body
    xl: '1.25rem',   // 20px — section headings
    '2xl': '1.5rem', // 24px — page titles
    '3xl': '1.875rem', // 30px — hero headings
    '4xl': '2.25rem',  // 36px — landing page hero
  },
  lineHeights: {
    tight: '1.2',
    normal: '1.5',
    relaxed: '1.75',
  },
  weights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
},
```

- [ ] **Step 2:** Add CSS variables in `globals.css` `:root`:

```css
--text-xs: 0.75rem;
--text-sm: 0.875rem;
--text-base: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.25rem;
--text-2xl: 1.5rem;
--text-3xl: 1.875rem;
--text-4xl: 2.25rem;
```

- [ ] **Step 3:** In `globals.css`, update the heading styles to use the scale:

```css
h1 { font-size: var(--text-2xl); }
h2 { font-size: var(--text-xl); }
h3 { font-size: var(--text-lg); }
h4 { font-size: var(--text-base); }
```

- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Headings now have consistent sizes.

### Task U1.4 — Fix the dark/light theme strategy

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css`

**Problem:** `html className="dark"` is hardcoded but there are NO `.dark` CSS rules — the class is decorative. Theme flips only with OS `prefers-color-scheme: light`, which overrides to a light palette that badges/text weren't designed for. Users can't choose a theme.

- [ ] **Step 1:** In `apps/web/app/layout.tsx`, remove the hardcoded `className="dark"` from the `<html>` tag. Instead, set the dark theme as the default via a script that runs before hydration:

```tsx
<html lang="en" suppressHydrationWarning>
  <head>
    <script dangerouslySetInnerHTML={{ __html: `
      try {
        const theme = localStorage.getItem('theme');
        if (theme === 'light') {
          document.documentElement.classList.add('light');
        } else {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {
        document.documentElement.classList.add('dark');
      }
    `}} />
  </head>
```

- [ ] **Step 2:** In `globals.css`, replace the `@media (prefers-color-scheme: light)` block with a `.light` class selector. Keep all the dark theme values as the default (`:root`), and add `.light` overrides:

```css
/* Light theme overrides — applied when .light class is on <html> */
.light {
  --color-backdrop: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-text-primary: #0F172A;
  --color-text-secondary: #334155;
  --color-text-muted: #64748B;
  --color-border: rgba(99, 102, 241, 0.12);
  --color-border-active: rgba(99, 102, 241, 0.3);
  --color-pending: #B45309;
  --color-approved: #15803D;
  --color-rejected: #B91C1C;
}
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. The app defaults to dark; when `.light` is added to `<html>`, the light palette applies.

### Task U1.5 — Add a theme toggle to the sidebar

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`

**Problem:** No way for users to switch between dark and light theme.

- [ ] **Step 1:** Read `apps/web/components/Sidebar.tsx`. Find the footer section (near the sign-out button).

- [ ] **Step 2:** Add a theme toggle button before the sign-out button:

```tsx
<button
  onClick={() => {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  }}
  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
  aria-label="Toggle theme"
>
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 001.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" />
  </svg>
  {!collapsed && <span>Toggle theme</span>}
</button>
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Clicking the toggle switches between dark and light.

---

## PHASE U2 — FIX LAYOUT, NAVIGATION, AND IDENTITY

### Task U2.0 — Build a professional landing page

**Files:**
- Modify: `apps/web/app/page.tsx`

**Problem:** The home page is `<h1>E-Logbook</h1>` on a black background. This is the public face of a medical SaaS — it needs to be professional or redirect to login.

- [ ] **Step 1:** Read `apps/web/app/page.tsx` (3 lines).

- [ ] **Step 2:** Replace the entire file with a server component that redirects authenticated users to their dashboard and shows a marketing landing page for unauthenticated visitors:

```tsx
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

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
      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-20">
        <div className="max-w-3xl text-center">
          <h1 className="text-4xl font-heading font-bold mb-4 text-text-primary">
            E-Logbook Enterprise
          </h1>
          <p className="text-lg text-text-secondary mb-2">
            The enterprise-grade electronic logbook for medical residents.
          </p>
          <p className="text-base text-text-muted mb-8">
            Log procedures, map to accreditation milestones, and receive supervisor verifications —
            securely, offline-ready, and HIPAA-compliant.
          </p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover transition-colors"
          >
            Sign in to your account
          </Link>
        </div>
      </main>

      {/* Features */}
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

      {/* Footer */}
      <footer className="px-4 py-6 border-t border-border text-center">
        <p className="text-xs text-text-muted">
          © 2026 E-Logbook Enterprise. HIPAA-compliant. SOC 2 ready.
        </p>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Visit `/` — should show the landing page with hero, features, and sign-in button.

### Task U2.1 — Add user identity to the sidebar

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`
- Modify: `apps/web/components/Sidebar.tsx`

**Problem:** The sidebar has no user identity — no avatar, name, role, or tenant. In a multi-tenant PHI app, users must always see who they are and which tenant they're in.

- [ ] **Step 1:** Read `apps/web/app/(authenticated)/[tenant]/layout.tsx`. Find where `auth` is available and pass user info to the Sidebar.

- [ ] **Step 2:** In `[tenant]/layout.tsx`, pass the auth context to the Sidebar:

```tsx
<Sidebar
  tenantSlug={tenantSlug}
  navLinks={navLinks}
  user={{
    name: auth.profile.full_name,
    role: auth.profile.role,
    tenantName: auth.tenant.slug,
  }}
/>
```

- [ ] **Step 3:** In `Sidebar.tsx`, add a `user` prop and render a user identity card at the bottom (above the theme toggle and sign-out):

```tsx
interface SidebarProps {
  // ... existing props
  user?: {
    name: string;
    role: string;
    tenantName: string;
  };
}

// In the component, before the sign-out button:
{user && !collapsed && (
  <div className="px-3 py-3 rounded-lg bg-surface border border-border">
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-medium flex-shrink-0">
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
        <p className="text-xs text-text-muted capitalize">{user.role} · {user.tenantName}</p>
      </div>
    </div>
  </div>
)}
{user && collapsed && (
  <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-medium mx-auto" title={user.name}>
    {user.name.charAt(0).toUpperCase()}
  </div>
)}
```

- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Sidebar shows user name, role, and tenant.

### Task U2.2 — Add icons to MobileNav

**Files:**
- Modify: `apps/web/components/MobileNav.tsx`

**Problem:** The bottom tab bar is text-only. Bottom tab bars universally require icons for scannability.

- [ ] **Step 1:** Read `apps/web/components/MobileNav.tsx`. Find the nav items rendering (around line 85-100).

- [ ] **Step 2:** Add icons. Import the same icon paths from Sidebar and render them above the text labels. For each nav item, add:

```tsx
<svg className="w-5 h-5 mb-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
  <path d={iconMap[item.label]?.path || ''} />
</svg>
<span className="text-xs">{item.label}</span>
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Mobile nav shows icons + text.

### Task U2.3 — Add breadcrumbs

**Files:**
- Create: `apps/web/components/Breadcrumbs.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`

**Problem:** No breadcrumbs anywhere. Deep pages (case detail, admin/overview) have no navigation context.

- [ ] **Step 1:** Create `apps/web/components/Breadcrumbs.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Crumb {
  label: string;
  href?: string;
}

export default function Breadcrumbs({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  // Skip the tenant slug (first segment)
  const crumbs: Crumb[] = segments.slice(1).map((seg, i) => {
    const href = '/' + segments.slice(0, i + 2).join('/');
    const label = seg
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return { label, href: i < segments.length - 2 ? href : undefined };
  });

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-1.5 text-sm text-text-muted">
        <li>
          <Link href={`/${tenantSlug}/dashboard`} className="hover:text-text-primary transition-colors">
            Home
          </Link>
        </li>
        {crumbs.map((crumb, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="text-text-muted/40">/</span>
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-text-primary transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-text-secondary">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 2:** In `[tenant]/layout.tsx`, add `<Breadcrumbs tenantSlug={tenantSlug} />` inside the `<main>` tag, before `{children}`.

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Breadcrumbs appear on sub-pages.

### Task U2.4 — Fix responsive page padding

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`

**Problem:** Fixed `p-6` padding on all screens — wastes 13% of width on a 360px phone.

- [ ] **Step 1:** In `[tenant]/layout.tsx`, change the `<main>` padding from `p-6` to `p-3 sm:p-6`.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U2.5 — Add a content max-width

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`

**Problem:** No container max-width — on a 34" monitor, content spans full width, hurting readability.

- [ ] **Step 1:** In `[tenant]/layout.tsx`, wrap the `{children}` in a `max-w-7xl mx-auto w-full` container:

```tsx
<main id="main-content" className="flex-1 p-3 sm:p-6 pb-16 md:pb-6">
  <div className="max-w-7xl mx-auto w-full">
    <Breadcrumbs tenantSlug={tenantSlug} />
    {children}
  </div>
</main>
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Content is centered with max width on wide screens.

### Task U2.6 — Add a cases table horizontal scroll wrapper

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/page.tsx`

**Problem:** The 5-column cases table has no horizontal scroll wrapper — columns overflow on mobile.

- [ ] **Step 1:** Read `apps/web/app/(authenticated)/[tenant]/cases/page.tsx`. Find the `<Table.Root>` (around line 93).

- [ ] **Step 2:** Wrap the table in an `overflow-x-auto` div:

```tsx
<div className="overflow-x-auto">
  <Table.Root ...>
    ...
  </Table.Root>
</div>
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

---

## PHASE U3 — FIX THE LOGIN PAGE

### Task U3.0 — Fix login page layout and styling

**Files:**
- Modify: `apps/web/app/login/page.tsx`

**Problem:** The login page has broken layout — likely because the HeroUI tokens are undefined and the page uses `bg-backdrop` which may not resolve correctly. The form also has no `<form>` wrapper (Enter doesn't submit).

- [ ] **Step 1:** Read `apps/web/app/login/page.tsx` fully.

- [ ] **Step 2:** Wrap the inputs and button in a `<form onSubmit={handleSubmit}>` element. Change the button to `type="submit"`.

- [ ] **Step 3:** Add a loading spinner to the submit button when `loading` is true:

```tsx
<button
  type="submit"
  disabled={!email || loading}
  className="w-full py-2.5 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
>
  {loading && (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )}
  {loading ? 'Signing in...' : buttonLabel}
</button>
```

- [ ] **Step 4:** Add a "Sign in with SSO" link below the button (for enterprise tenants):

```tsx
<p className="text-xs text-text-muted text-center mt-4">
  Enterprise user? <Link href="/login/sso" className="text-primary hover:underline">Sign in with SSO</Link>
</p>
```

- [ ] **Step 5:** Make sure the error display uses `ErrorDisplay` or at minimum uses `text-danger` (which now exists after U1.0) instead of `danger-banner` class:

```tsx
{error && (
  <div role="alert" className="bg-danger-50 text-danger text-xs rounded-lg p-2.5 border border-danger/20">
    {error}
  </div>
)}
```

- [ ] **Step 6: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Login page renders with styled inputs, a real form, loading spinner, and SSO link.

### Task U3.1 — Fix login page OTP error handling

**Files:**
- Modify: `apps/web/app/login/page.tsx`

**Problem:** `handleOtpLogin` never checks the result of `signInWithOtp`; `setSent(true)` runs unconditionally — user believes an email was sent when it wasn't.

- [ ] **Step 1:** In `handleOtpLogin`, check the error:

```tsx
const { error: otpError } = await supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: redirectTo },
});
if (otpError) {
  setError(otpError.message);
  setLoading(false);
  return;
}
setSent(true);
setLoading(false);
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U3.2 — Fix the success state for magic link

**Files:**
- Modify: `apps/web/app/login/page.tsx`

**Problem:** The magic link "success" state is just plain text with no visual treatment.

- [ ] **Step 1:** Replace the `{sent ? (...) : (...)}` success block with:

```tsx
{sent ? (
  <div className="text-center py-8">
    <div className="w-12 h-12 rounded-full bg-success-50 text-success flex items-center justify-center mx-auto mb-4">
      <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
      </svg>
    </div>
    <p className="text-success font-medium text-sm mb-1">Check your email!</p>
    <p className="text-xs text-text-muted">We sent a magic link to {email}. Click it to sign in.</p>
  </div>
) : ( ... existing form ... )}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

---

## PHASE U4 — FIX THE DASHBOARD AND ROLE-BASED UX

### Task U4.0 — Fix director/admin dashboard KPIs

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`

**Problem:** Director/admin KPIs are computed from a 100-row sample, not the tenant total. For a 2,000-case program, the "Approved"/"Pending" rings show ~100, not the true total.

- [ ] **Step 1:** Read `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`. Find the query that fetches cases (around line 58).

- [ ] **Step 2:** For non-resident users, replace the limited fetch with count queries per status:

```tsx
// For directors/admins, fetch counts per status (not a row sample)
if (!isResident) {
  const [pendingCount, approvedCount, rejectedCount, draftCount] = await Promise.all([
    supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', auth.profile.tenant_id).eq('status', 'pending').is('deleted_at', null),
    supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', auth.profile.tenant_id).eq('status', 'approved').is('deleted_at', null),
    supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', auth.profile.tenant_id).eq('status', 'rejected').is('deleted_at', null),
    supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', auth.profile.tenant_id).eq('status', 'draft').is('deleted_at', null),
  ]);
  stats = {
    pending: pendingCount.count ?? 0,
    approved: approvedCount.count ?? 0,
    rejected: rejectedCount.count ?? 0,
    draft: draftCount.count ?? 0,
    total: (pendingCount.count ?? 0) + (approvedCount.count ?? 0) + (rejectedCount.count ?? 0) + (draftCount.count ?? 0),
  };
}
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Director dashboard shows accurate total counts.

### Task U4.1 — Fix the "Today" metric in approvals

**Files:**
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`

**Problem:** The "Today" metric counts cases with `case_date === today` (procedure date), not cases submitted today. Misleading.

- [ ] **Step 1:** Find the "Today" calculation (around line 200). Change it to compare `created_at` to today:

```tsx
const today = new Date().toISOString().split('T')[0];
const todayCount = pendingCases.filter((c) => c.created_at?.startsWith(today)).length;
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U4.2 — Fix the mojibake in approvals

**Files:**
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`

**Problem:** Line 290 renders `ΓÇô` (corrupted en-dash) in production template names.

- [ ] **Step 1:** Find line 290. Replace `ΓÇô` with a literal `–` (en-dash, U+2013) or `—` (em-dash).

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. No mojibake in the approvals UI.

### Task U4.3 — Replace base-palette colors with tokens

**Files:**
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`
- Modify: `apps/web/components/SubscriptionPlans.tsx`
- Modify: `apps/web/components/ApprovalActions.tsx`
- Modify: `apps/web/components/Toast.tsx`
- Modify: `apps/web/components/DashboardContent.tsx`
- Modify: `apps/web/components/ReadOnlyBanner.tsx`

**Problem:** Multiple components use banned Tailwind base palette colors (`teal-*`, `amber-*`, `emerald-*`, `red-*`, `indigo-*`) instead of clinical tokens.

- [ ] **Step 1:** In each file, search for and replace:
  - `teal-400` → `primary` (or `text-primary`)
  - `teal-500` → `primary`
  - `teal-600` → `primary-hover`
  - `amber-400` → `pending` (or `text-pending`)
  - `amber-500` → `pending`
  - `emerald-400` → `approved` (or `text-approved`)
  - `emerald-500` → `approved`
  - `emerald-200` → `approved`
  - `emerald-300` → `approved`
  - `red-400` → `rejected` (or `text-rejected`)
  - `red-500` → `rejected` (or `text-danger`)
  - `red-200` → `rejected`
  - `indigo-400` → `secondary` (or `text-secondary`)
  - `bg-neutral-700` → `bg-neutral-dark`
  - `text-neutral-300` → `text-text-muted`

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. `grep -r "teal-\|amber-\|emerald-\|red-[0-9]\|indigo-" apps/web/components/` → zero or near-zero matches.

### Task U4.4 — Add supervisor case-browsing view

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/page.tsx`

**Problem:** `cases/page.tsx` filters by `resident_id === auth.profile.id` for all roles. Supervisors see an empty list — they can't browse resident cases outside the approvals queue.

- [ ] **Step 1:** Read the cases page. Find the query filter (around line 43).

- [ ] **Step 2:** Make the filter role-aware:

```tsx
const isResident = auth.profile.role === 'resident';
let query = supabase.from('case_entries').select('...').eq('tenant_id', auth.profile.tenant_id);
if (isResident) {
  query = query.eq('resident_id', auth.profile.id);
}
// Supervisors+ see all tenant cases
```

- [ ] **Step 3:** Add a resident filter dropdown for supervisors+ (optional — can be a follow-up).

- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U4.5 — Fix the read-only dashboard CTA colors

**Files:**
- Modify: `apps/web/components/DashboardContent.tsx`

**Problem:** The read-only CTA uses `bg-neutral-700 text-neutral-300` which are undefined in the custom theme.

- [ ] **Step 1:** Find line 155. Replace `bg-neutral-700 text-neutral-300` with `bg-neutral-dark text-text-muted`.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

---

## PHASE U5 — FIX CASE FORM AND APPROVALS

### Task U5.0 — Fix ConfirmDialog accessibility

**Files:**
- Modify: `apps/web/components/case-form/ConfirmDialog.tsx`

**Problem:** No `role="dialog"`, no `aria-modal`, no focus trap, no focus restore.

- [ ] **Step 1:** Add `role="dialog"` and `aria-modal="true"` to the overlay div. Add an `aria-labelledby` pointing to the title.

- [ ] **Step 2:** Add a basic focus trap: on open, focus the cancel button. On Escape, call `onCancel`. Prevent tab from leaving the dialog by adding a focusable sentinel at the end.

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Tab cycles within the dialog.

### Task U5.1 — Add confirmation to approve/reject

**Files:**
- Modify: `apps/web/components/ApprovalActions.tsx`

**Problem:** Approve/Reject are irreversible medical records with zero confirmation and no required comment.

- [ ] **Step 1:** Add a confirmation step before reject. Use a simple `window.confirm` as a minimal fix:

```tsx
const handleReject = async () => {
  const confirmed = window.confirm('Are you sure you want to reject this case? This action is irreversible.');
  if (!confirmed) return;
  // ... existing reject logic
};
```

- [ ] **Step 2:** Add a toast on success:

```tsx
import { useToast } from './Toast';
// In the component:
const { showToast } = useToast();
// After successful approve:
showToast('Case approved successfully', 'success');
// After successful reject:
showToast('Case rejected', 'warning');
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U5.2 — Add template loading skeleton to CaseForm

**Files:**
- Modify: `apps/web/components/CaseForm.tsx`

**Problem:** `loadingTemplates` is tracked but never rendered — the Select renders empty until data arrives.

- [ ] **Step 1:** Find where `loadingTemplates` is set (around line 73). In the TemplateStep render area, add a skeleton:

```tsx
{loadingTemplates ? (
  <div className="space-y-3">
    <div className="h-10 bg-surface rounded-lg animate-pulse" />
    <div className="h-10 bg-surface rounded-lg animate-pulse" />
  </div>
) : (
  // existing template grid
)}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U5.3 — Fix inline fontFamily styles

**Files:**
- Modify: `apps/web/components/case-form/TemplateStep.tsx`
- Modify: `apps/web/components/case-form/PatientInfoStep.tsx`
- Modify: `apps/web/components/case-form/CaseDetailsStep.tsx`
- Modify: `apps/web/components/case-form/ReviewStep.tsx`
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`

**Problem:** Repeated `style={{ fontFamily: 'var(--font-heading)' }}` instead of the `font-heading` Tailwind class.

- [ ] **Step 1:** In each file, replace `style={{ fontFamily: 'var(--font-heading)' }}` with `className="font-heading"` (the class already exists in `tailwind.config.ts:36`).

- [ ] **Step 2: DOUBLE-CHECK.** `grep -r "fontFamily.*var(--font" apps/web/components/` → zero matches.

### Task U5.4 — Fix ReviewStep mono font

**Files:**
- Modify: `apps/web/components/case-form/ReviewStep.tsx`

**Problem:** Mono font is applied via inline `style={{fontFamily:'var(--font-mono)'}}` instead of the `.clinical-data` class.

- [ ] **Step 1:** Replace inline `style={{ fontFamily: 'var(--font-mono)' }}` with `className="clinical-data"`.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U5.5 — Add PHI/confidentiality banner to case detail

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`

**Problem:** Case detail exposes PHI (MRN, DOB) with no confidentiality banner. De-identified cases show blank fields with no explanation.

- [ ] **Step 1:** At the top of the case detail content, add a confidentiality banner:

```tsx
{entry.is_deidentified ? (
  <div className="bg-warning-50 border border-warning/20 text-warning text-xs rounded-lg p-2.5 mb-4" role="status">
    This case is de-identified. Patient MRN and DOB are not stored; a hash is used for matching.
  </div>
) : (
  <div className="bg-danger-50 border border-danger/20 text-danger text-xs rounded-lg p-2.5 mb-4" role="status">
    <strong>PHI:</strong> This case contains identified patient data. Handle with care per HIPAA guidelines.
  </div>
)}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

---

## PHASE U6 — FIX ALL DATA PAGES

### Task U6.0 — Add error branches to all data pages

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/goals/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/billing/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/consent/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`

**Problem:** These pages destructure `{ data }` without `error`. Failed queries silently yield empty data — looks like "no data" when the DB is down. Dangerous for a medical app.

- [ ] **Step 1:** In each file, find every `const { data } = await supabase.from(...)` call. Add `error` to the destructuring. After the call, add:

```tsx
if (error) {
  return <ErrorDisplay error={new Error(error.message)} />;
}
```

Import `ErrorDisplay` from `@/components/ErrorDisplay`.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. `grep -r "const { data } = await supabase" apps/web/app/` → zero matches without `error`.

### Task U6.1 — Add loading skeletons to all data pages

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/goals/loading.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/reports/loading.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/billing/loading.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/admin/loading.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/consent/loading.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/cases/[id]/loading.tsx`
- Create: `apps/web/app/(authenticated)/[tenant]/cases/new/loading.tsx`

**Problem:** Most data pages are server components with no loading skeleton — blank panel on slow networks.

- [ ] **Step 1:** For each route, create a `loading.tsx` file:

```tsx
import CardSkeleton from '@/components/CardSkeleton';

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-surface rounded-lg animate-pulse" />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. All routes have loading states.

### Task U6.2 — Fix audit page error display

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/audit/page.tsx`

**Problem:** Audit page uses raw `<p className="text-danger">` for errors instead of `ErrorDisplay`.

- [ ] **Step 1:** Replace `return (<div><p className="text-danger">...` with `return <ErrorDisplay error={new Error(error.message)} />`.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U6.3 — Fix reports page unbounded query

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`

**Problem:** Fetches the entire `case_entries` table with no limit — unbounded query at scale.

- [ ] **Step 1:** Replace the unbounded fetch with count queries per status and per specialty. Use `select('id', { count: 'exact', head: true })` for each group.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U6.4 — Fix admin overview unbounded query

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/overview/page.tsx`

**Problem:** Fetches `limit(50)` case entries and derives KPIs from that 50-row sample. Wrong for any tenant with >50 cases.

- [ ] **Step 1:** Replace the limited fetch with count queries (same pattern as U4.0).

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U6.5 — Fix SubscriptionPlans error handling

**Files:**
- Modify: `apps/web/components/SubscriptionPlans.tsx`

**Problem:** Subscribe error is `console.error` only — no user-facing error.

- [ ] **Step 1:** Add a `setError` state and display it:

```tsx
const [error, setError] = useState('');
// In the catch block:
setError(err instanceof Error ? err.message : 'Failed to start checkout');
// In the JSX:
{error && <div role="alert" className="bg-danger-50 text-danger text-xs rounded-lg p-2.5 mt-2">{error}</div>}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U6.6 — Fix billing page AI credits section

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/billing/page.tsx`

**Problem:** The "AI Report Credits" section promises $4.99 reports but exposes no purchase button.

- [ ] **Step 1:** Either add a purchase button that calls the `create-checkout` edge function, or remove the section and add a "Coming soon" note. Prefer removing for now:

```tsx
<div className="panel p-6">
  <h3 className="text-lg font-heading font-semibold mb-2">AI Report Credits</h3>
  <p className="text-sm text-text-muted">AI-powered report generation is coming soon. Stay tuned for updates.</p>
</div>
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U6.7 — Fix ProgramOverviewCharts tooltip colors

**Files:**
- Modify: `apps/web/components/ProgramOverviewCharts.tsx`

**Problem:** Chart tooltip uses `bg-slate-800 border-white/10` (base palette).

- [ ] **Step 1:** Replace `bg-slate-800` with `bg-neutral-dark` and `border-white/10` with `border-border`.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U6.8 — Fix all remaining `aria-hidden` on decorative SVGs

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`
- Modify: `apps/web/components/DashboardContent.tsx`
- Modify: `apps/web/components/ErrorDisplay.tsx`
- Modify: `apps/web/components/Toast.tsx`
- Modify: `apps/web/components/CaseForm.tsx`
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`
- Modify: `apps/web/components/EmptyState.tsx`

**Problem:** Decorative SVGs lack `aria-hidden="true"` across the app.

- [ ] **Step 1:** In each file, find every `<svg` that is decorative (not the sole content of a button/link). Add `aria-hidden="true"` to it.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

---

## PHASE U7 — FIX ACCESSIBILITY AND RESPONSIVE

### Task U7.0 — Gate Framer Motion on prefers-reduced-motion

**Files:**
- Modify: `apps/web/components/DashboardContent.tsx`
- Modify: `apps/web/components/CaseForm.tsx`
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`
- Modify: `apps/web/components/ProgramOverviewCharts.tsx`

**Problem:** Framer-motion animations ignore `prefers-reduced-motion` — only CSS transitions are zeroed.

- [ ] **Step 1:** In each file that uses framer-motion, import `useReducedMotion` and conditionally disable animations:

```tsx
import { useReducedMotion } from 'framer-motion';
// In the component:
const reduceMotion = useReducedMotion();
// In motion components, use:
transition={reduceMotion ? { duration: 0 } : DEFAULT_TRANSITION}
// Or conditionally render without animation:
{reduceMotion ? <div>{children}</div> : <motion.div ...>{children}</motion.div>}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Enable OS "Reduce Motion" — animations are disabled.

### Task U7.1 — Fix MobileNav active state

**Files:**
- Modify: `apps/web/components/MobileNav.tsx`

**Problem:** Active state is color-only — no non-color cue, problematic for color-blind users.

- [ ] **Step 1:** Add a top indicator bar to the active tab:

```tsx
{isActive && (
  <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary rounded-b-full" />
)}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U7.2 — Fix Sidebar Admin icon viewBox

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`

**Problem:** The 'Admin' stroke-icon path is authored for a 24×24 grid but rendered in `viewBox="0 0 20 20"` — distorted glyph.

- [ ] **Step 1:** Find the Admin icon definition (around line 42). Change its `viewBox` to `"0 0 24 24"`:

```tsx
<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U7.3 — Fix RTL sidebar positioning

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`

**Problem:** `left-0` fixed positioning breaks in RTL mode (sidebar should be on the right).

- [ ] **Step 1:** Change `left-0` to `inset-y-0 start-0` (CSS logical property):

```tsx
<aside className="fixed inset-y-0 start-0 z-40 ...">
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U7.4 — Add not-found page

**Files:**
- Create: `apps/web/app/not-found.tsx`

**Problem:** No custom 404 page. All 404s use Next's default.

- [ ] **Step 1:** Create `apps/web/app/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-backdrop text-text-primary flex items-center justify-center p-4">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-heading font-bold mb-2">404</h1>
        <p className="text-text-muted mb-6">The page you're looking for doesn't exist or has been moved.</p>
        <Link href="/login" className="inline-block px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors">
          Go to login
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Visit a non-existent URL — branded 404 appears.

### Task U7.5 — Add Settings/Profile page

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/settings/page.tsx`

**Problem:** No settings page — name/specialty/password/MFA management unreachable in UI.

- [ ] **Step 1:** Create a basic settings page that shows the user's profile info and links to MFA enrollment:

```tsx
import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">Settings</h1>

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Profile</h2>
        <dl className="space-y-3">
          <div className="flex justify-between"><dt className="text-text-muted">Name</dt><dd>{auth.profile.full_name}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Role</dt><dd className="capitalize">{auth.profile.role}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Specialty</dt><dd>{auth.profile.specialty || '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Email</dt><dd>{auth.user.email}</dd></div>
        </dl>
      </div>

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Security</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Multi-factor authentication</p>
              <p className="text-xs text-text-muted">
                {auth.aal === 'aal2' ? 'Enabled' : 'Not enabled — required for directors and admins'}
              </p>
            </div>
            <Link href="/mfa/enroll" className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-colors">
              {auth.aal === 'aal2' ? 'Manage' : 'Set up'}
            </Link>
          </div>
        </div>
      </div>

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Consent</h2>
        <Link href={`/${tenantSlug}/consent`} className="text-primary text-sm hover:underline">Manage consent preferences →</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Add "Settings" to the nav links in `[tenant]/layout.tsx` (visible to all roles).

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. Settings page is accessible from the sidebar.

---

## PHASE U8 — ADD ONBOARDING AND POLISH

### Task U8.0 — Add MFA enroll QR code display

**Files:**
- Modify: `apps/web/app/mfa/enroll/page.tsx`

**Problem:** The MFA enroll page shows the raw `otpauth://` URI as text — users cannot scan a string.

- [ ] **Step 1:** Install a QR code library: `pnpm --filter @elogbook/web add qrcode.react`.

- [ ] **Step 2:** In the enroll page, render a QR code from the URI:

```tsx
import { QRCodeSVG } from 'qrcode.react';
// In the JSX, replace the raw URI display:
{qr && (
  <div className="flex flex-col items-center gap-4">
    <div className="bg-white p-4 rounded-lg">
      <QRCodeSVG value={qr.uri} size={200} />
    </div>
    <p className="text-xs text-text-muted">Scan with your authenticator app</p>
    <details className="text-xs text-text-muted">
      <summary>Can't scan? Enter manually</summary>
      <code className="block mt-2 p-2 bg-surface rounded text-xs break-all">{qr.secret}</code>
    </details>
  </div>
)}
```

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. MFA enroll page shows a scannable QR code.

### Task U8.1 — Add a first-run onboarding checklist

**Files:**
- Create: `apps/web/components/OnboardingChecklist.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`

**Problem:** No onboarding. New tenants have no guidance.

- [ ] **Step 1:** Create a checklist component for directors/admins that shows on the dashboard when the tenant has no templates, no goals, and no cases:

```tsx
'use client';

const steps = [
  { key: 'templates', label: 'Create a case template', href: '/{tenant}/admin', desc: 'Define the fields residents fill in for each procedure.' },
  { key: 'invite', label: 'Invite residents and supervisors', href: '/{tenant}/admin', desc: 'Add your team members and assign roles.' },
  { key: 'goals', label: 'Set accreditation goals', href: '/{tenant}/goals', desc: 'Define milestone targets for your program.' },
  { key: 'case', label: 'Log your first case', href: '/{tenant}/cases/new', desc: 'Try the case logging wizard yourself.' },
];

export default function OnboardingChecklist({ tenant, completed }: { tenant: string; completed: string[] }) {
  const incomplete = steps.filter((s) => !completed.includes(s.key));
  if (incomplete.length === 0) return null;

  return (
    <div className="panel p-6 mb-6 border border-primary/20">
      <h2 className="text-lg font-heading font-semibold mb-1">Welcome to E-Logbook! 🎉</h2>
      <p className="text-sm text-text-muted mb-4">Complete these steps to get your program running:</p>
      <ul className="space-y-3">
        {steps.map((step) => {
          const done = completed.includes(step.key);
          return (
            <li key={step.key} className="flex items-start gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${done ? 'bg-success text-white' : 'border-2 border-border'}`}>
                {done && <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M9.64 2.93L4.7 7.86 2.3 5.46l-1.06 1.06L4.7 9.98 10.7 4z" /></svg>}
              </div>
              <div className="flex-1">
                <p className={`text-sm ${done ? 'text-text-muted line-through' : 'text-text-primary'}`}>{step.label}</p>
                <p className="text-xs text-text-muted">{step.desc}</p>
                {!done && <a href={step.href.replace('{tenant}', tenant)} className="text-xs text-primary hover:underline">Get started →</a>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2:** In the dashboard page, check if templates/goals/cases exist and render the checklist for directors+ when the tenant is new.

- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U8.2 — Add global search input

**Files:**
- Modify: `apps/web/components/Sidebar.tsx`

**Problem:** No global search for a data-dense logbook.

- [ ] **Step 1:** Add a search input at the top of the sidebar (below the logo, above the nav links):

```tsx
<div className="px-3 mb-3">
  <input
    type="search"
    placeholder="Search cases..."
    className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary transition-colors"
    onChange={(e) => {
      // For now, navigate to cases page with search query
      if (e.target.value.length > 2) {
        window.location.href = `/${tenantSlug}/cases?q=${encodeURIComponent(e.target.value)}`;
      }
    }}
  />
</div>
```

Note: This is a minimal implementation. A real search would use a debounced API call or client-side filtering. This can be a follow-up.

- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds.

### Task U8.3 — Final visual polish pass

**Files:** All component files

**Problem:** Various small inconsistencies remain.

- [ ] **Step 1:** Audit all pages for consistent heading sizes. Every page title should use `text-2xl font-heading font-bold`. Every section heading should use `text-lg font-heading font-semibold`.

- [ ] **Step 2:** Ensure every page has a consistent `space-y-6` between top-level sections.

- [ ] **Step 3:** Ensure every interactive element has `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow` for keyboard accessibility.

- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` → succeeds. `pnpm test` → all pass. The app looks consistent and professional.

---

## VERIFICATION CHECKLIST

After completing all phases, verify:

- [ ] `pnpm --filter @elogbook/web typecheck` → exit 0
- [ ] `pnpm --filter @elogbook/web build` → 0 errors, all routes compiled
- [ ] `pnpm test` → all tests pass
- [ ] Home page (`/`) shows a professional landing page
- [ ] Login page renders with styled inputs, loading spinner, SSO link
- [ ] Sidebar shows user identity (name, role, tenant)
- [ ] Dashboard KPIs are accurate for all roles
- [ ] Approvals have confirmation + toast
- [ ] Case form has loading skeleton for templates
- [ ] All data pages have loading skeletons
- [ ] All data pages have error branches with `ErrorDisplay`
- [ ] No mojibake characters anywhere
- [ ] No undefined Tailwind classes (all HeroUI tokens generate)
- [ ] No base-palette colors (all use clinical tokens)
- [ ] Breadcrumbs appear on sub-pages
- [ ] Settings page is accessible
- [ ] 404 page is branded
- [ ] MFA enroll shows a QR code
- [ ] Onboarding checklist appears for new tenants
- [ ] Theme toggle works (dark/light)
- [ ] All decorative SVGs have `aria-hidden="true"`
- [ ] `prefers-reduced-motion` is respected

---

*End of plan. 42 tasks across 8 phases. Every task is verifiable by a small LLM that follows the DOUBLE-CHECK mandate.*
