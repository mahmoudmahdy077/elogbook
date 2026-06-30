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
