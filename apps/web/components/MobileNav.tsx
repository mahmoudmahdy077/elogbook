'use client';

import { useState, useRef, useEffect, type ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

type NavLink = {
  href: string;
  label: string;
  roles: string[];
};

const MAX_VISIBLE = 4;

// U2.3: Compact icons for the bottom tab bar. Same paths as Sidebar.
const ICONS: Record<string, ReactElement> = {
  Dashboard: <path d="M3.75 3A1.5 1.5 0 002.25 4.5v2.25A1.5 1.5 0 003.75 8.25h2.25A1.5 1.5 0 007.5 6.75V4.5A1.5 1.5 0 006 3H3.75zm0 7.5A1.5 1.5 0 002.25 12v2.25A1.5 1.5 0 003.75 15.75h2.25A1.5 1.5 0 007.5 14.25V12a1.5 1.5 0 00-1.5-1.5H3.75zm7.5 0A1.5 1.5 0 009.75 12v2.25a1.5 1.5 0 001.5 1.5h2.25a1.5 1.5 0 001.5-1.5V12a1.5 1.5 0 00-1.5-1.5h-2.25zM9.75 4.5A1.5 1.5 0 0011.25 6v2.25a1.5 1.5 0 01-1.5 1.5H7.5V6a1.5 1.5 0 011.5-1.5h.75z" />,
  Cases: <path d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5z" />,
  Approvals: <path d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" />,
  Goals: <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" />,
  Reports: <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />,
  Billing: <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9z" />,
  Audit: <path d="M9 12.75L11.25 15 15 10.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  Admin: <path d="M3.75 6.75h8.5M3.75 12h8.5M3.75 17.25h8.5M17.25 6.75v-1.5a1.5 1.5 0 00-1.5-1.5h-1.5M17.25 17.25v1.5a1.5 1.5 0 01-1.5 1.5h-1.5" />,
};

export default function MobileNav({
  visibleLinks,
  tenantSlug,
}: {
  visibleLinks: NavLink[];
  tenantSlug: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const primaryLinks = visibleLinks.slice(0, MAX_VISIBLE);
  const overflowLinks = visibleLinks.slice(MAX_VISIBLE);

  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [moreOpen]);

  function isLinkActive(href: string) {
    const fullHref = `/${tenantSlug}${href}`;
    return pathname === fullHref || pathname.startsWith(fullHref + '/');
  }

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 panel rounded-none border-t z-40">
      <nav className="flex justify-around py-2 px-1">
        {primaryLinks.map((link) => {
          const fullHref = `/${tenantSlug}${link.href}`;
          const isActive = isLinkActive(link.href);

          return (
            <Link
              key={link.href}
              href={fullHref}
              className={
                'relative flex flex-col items-center gap-0.5 px-1 py-1 text-xs transition-colors rounded-md min-w-[44px] min-h-[44px] justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow ' +
                (isActive
                  ? 'text-primary font-medium'
                  : 'text-neutral-light/50')
              }
            >
              {/* U7.1: active state has a top indicator bar (not color-only). */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary rounded-b-full" />
              )}
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                {ICONS[link.label] ?? <circle cx="10" cy="10" r="3" />}
              </svg>
              <span>{link.label}</span>
            </Link>
          );
        })}

        {overflowLinks.length > 0 && (
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className={
                'flex flex-col items-center gap-0.5 px-1 py-1 text-xs transition-colors rounded-md min-w-[44px] min-h-[44px] justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow ' +
                (moreOpen || overflowLinks.some((l) => isLinkActive(l.href))
                  ? 'text-primary font-medium'
                  : 'text-neutral-light/50')
              }
              aria-expanded={moreOpen}
              aria-label="More navigation"
            >
              <span>More</span>
            </button>

            <AnimatePresence>
              {moreOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute bottom-full mb-2 right-0 w-44 panel p-1.5 shadow-lg"
                >
                  {overflowLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={`/${tenantSlug}${link.href}`}
                      className={
                        'block px-3 py-2 rounded-md text-sm ' +
                        (isLinkActive(link.href)
                          ? 'bg-primary/15 text-primary font-medium'
                          : 'hover:bg-neutral-dark/50')
                      }
                    >
                      {link.label}
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </nav>
    </div>
  );
}
