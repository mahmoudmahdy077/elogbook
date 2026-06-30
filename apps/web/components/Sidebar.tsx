'use client';

import { APP_NAME } from '@elogbook/shared';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LocaleSwitcher from './LocaleSwitcher';

type NavLink = {
  href: string;
  label: string;
  roles: string[];
};

export default function Sidebar({
  visibleLinks,
  tenantSlug,
  user,
}: {
  visibleLinks: NavLink[];
  tenantSlug: string;
  user?: { name: string; role: string; tenantName: string };
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  const iconMap: Record<string, { path: string; type: 'fill' | 'stroke' }> = {
    'Dashboard': { path: 'M3.75 3A1.5 1.5 0 002.25 4.5v2.25A1.5 1.5 0 003.75 8.25h2.25A1.5 1.5 0 007.5 6.75V4.5A1.5 1.5 0 006 3H3.75zm0 7.5A1.5 1.5 0 002.25 12v2.25A1.5 1.5 0 003.75 15.75h2.25A1.5 1.5 0 007.5 14.25V12a1.5 1.5 0 00-1.5-1.5H3.75zm7.5 0A1.5 1.5 0 009.75 12v2.25a1.5 1.5 0 001.5 1.5h2.25a1.5 1.5 0 001.5-1.5V12a1.5 1.5 0 00-1.5-1.5h-2.25zM9.75 4.5A1.5 1.5 0 0011.25 6v2.25a1.5 1.5 0 01-1.5 1.5H7.5V6a1.5 1.5 0 011.5-1.5h.75z', type: 'fill' },
    'Cases': { path: 'M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5zM4.75 10.75a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 4.25a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z', type: 'fill' },
    'Approvals': { path: 'M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z', type: 'fill' },
    'Goals': { path: 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z', type: 'fill' },
    'Reports': { path: 'M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z', type: 'fill' },
    'Billing': { path: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9z M4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', type: 'fill' },
    'Audit': { path: 'M9 12.75L11.25 15 15 10.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z', type: 'stroke' },
    'Admin': { path: 'M3.75 6.75h8.5M3.75 12h8.5M3.75 17.25h8.5M17.25 6.75v-1.5a1.5 1.5 0 00-1.5-1.5h-1.5M17.25 17.25v1.5a1.5 1.5 0 01-1.5 1.5h-1.5', type: 'stroke' },
  };

  function renderIcon(icon: { path: string; type: 'fill' | 'stroke' }, className: string) {
    if (icon.type === 'stroke') {
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon.path} />
        </svg>
      );
    }
    return (
      <svg className={className} viewBox="0 0 20 20" fill="currentColor">
        <path d={icon.path} />
      </svg>
    );
  }

  return (
    <>
      <aside
        className={`panel flex-shrink-0 p-4 flex flex-col transition-all duration-200 max-md:hidden ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className={`mb-6 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <Link
            href={`/${tenantSlug}/dashboard`}
            className={`font-bold font-heading hover:text-primary transition-colors ${
              collapsed ? 'text-lg' : 'text-xl'
            }`}
            aria-label="Go to dashboard"
          >
            {collapsed ? 'E' : APP_NAME}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`p-1.5 rounded-md hover:bg-neutral-dark/50 transition-colors text-neutral-light/50 hover:text-neutral-light ${
              collapsed ? 'hidden' : ''
            }`}
            aria-label="Collapse sidebar"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M15.79 14.77a.75.75 0 01-1.06.02l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 111.04 1.08L11.832 10l3.938 3.71a.75.75 0 01.02 1.06zM8.29 14.77a.75.75 0 01-1.06.02l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 111.04 1.08L4.332 10l3.938 3.71a.75.75 0 01.02 1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-col gap-0.5 flex-1">
          {visibleLinks.map((link) => {
            const fullHref = `/${tenantSlug}${link.href}`;
            const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/');
            const icon = iconMap[link.label];

            return (
              <Link
                key={link.href}
                href={fullHref}
                title={collapsed ? link.label : undefined}
                aria-label={link.label}
                className={
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow ' +
                  (isActive
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-neutral-light/60 hover:bg-neutral-dark/50 hover:text-neutral-light') +
                  (collapsed ? ' justify-center' : '')
                }
              >
                {icon && renderIcon(icon, `w-4 h-4 shrink-0`)}
                {!collapsed && <span>{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className={`mt-auto pt-4 border-t border-border ${collapsed ? 'flex justify-center' : ''}`}>
          {/* U1.5: Theme toggle — persists to localStorage, read by the
              inline script in layout.tsx to avoid hydration flash. */}
          {collapsed ? (
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
              className="p-2 rounded-md hover:bg-neutral-dark/50 transition-colors text-neutral-light/50 hover:text-neutral-light"
              aria-label="Toggle theme"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            </button>
          ) : (
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
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-neutral-dark/50 hover:text-text-primary transition-colors"
              aria-label="Toggle theme"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
              <span>Toggle theme</span>
            </button>
          )}
          {!collapsed && <LocaleSwitcher current={typeof document !== 'undefined' ? (document.documentElement.lang || 'en') : 'en'} />}
          {collapsed ? (
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setCollapsed(false)}
                className="p-2 rounded-md hover:bg-neutral-dark/50 transition-colors text-neutral-light/50 hover:text-neutral-light"
                aria-label="Expand sidebar"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.21 14.77a.75.75 0 01.02-1.06L8.168 10 4.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06.02zM11.71 14.77a.75.75 0 01.02-1.06L15.668 10l-3.938-3.71a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06.02z" clipRule="evenodd" />
                </svg>
              </button>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="p-2 rounded-md hover:bg-danger/10 text-danger/60 hover:text-danger transition-colors"
                  aria-label="Sign out"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M6 10a.75.75 0 01.75-.75h9.546l-1.048-.943a.75.75 0 111.004-1.114l2.5 2.25a.75.75 0 010 1.114l-2.5 2.25a.75.75 0 11-1.004-1.114l1.048-.943H6.75A.75.75 0 016 10z" clipRule="evenodd" />
                  </svg>
                </button>
              </form>
            </div>
          ) : (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-danger/10 text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
              >
                Sign Out
              </button>
            </form>
          )}
        </div>
      </aside>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-30 p-1.5 rounded-r-md panel border-l-0 hover:border-primary transition-colors max-md:hidden"
          aria-label="Expand sidebar"
        >
          <svg className="w-3.5 h-3.5 text-neutral-light/50" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06.02z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </>
  );
}
