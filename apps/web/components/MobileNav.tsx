'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';

type NavLink = {
  href: string;
  label: string;
  roles: string[];
};

const MAX_VISIBLE = 4;

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

  function renderLink(link: NavLink) {
    const fullHref = `/${tenantSlug}${link.href}`;
    const isActive = isLinkActive(link.href);

    return (
      <Link
        key={link.href}
        href={fullHref}
        onClick={() => setMoreOpen(false)}
        className={
          'flex items-center gap-2 px-3 py-2 text-sm transition-colors rounded-md ' +
          (isActive
            ? 'text-primary font-medium bg-primary/10'
            : 'text-neutral-light/60 hover:text-neutral-light hover:bg-neutral-dark/50')
        }
      >
        {link.label}
        {isActive && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
        )}
      </Link>
    );
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
                'flex flex-col items-center gap-0.5 px-1 py-1 text-xs transition-colors rounded-md min-w-[44px] min-h-[44px] justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow ' +
                (isActive
                  ? 'text-primary font-medium'
                  : 'text-neutral-light/50')
              }
            >
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
                  {overflowLinks.map(renderLink)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </nav>
    </div>
  );
}
