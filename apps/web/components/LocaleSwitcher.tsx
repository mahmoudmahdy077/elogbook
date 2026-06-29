'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const SUPPORTED = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
] as const;

export default function LocaleSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState(current);

  const switchTo = (code: string) => {
    setActive(code);
    document.cookie = `NEXT_LOCALE=${code};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = code;
      document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    }
    startTransition(() => {
      router.refresh();
      router.push(pathname);
    });
  };

  return (
    <div className="px-3 py-2 text-xs">
      <div className="text-neutral-light/40 mb-1">Language</div>
      <div className="flex gap-1">
        {SUPPORTED.map((l) => (
          <button
            key={l.code}
            onClick={() => switchTo(l.code)}
            disabled={pending}
            className={
              'flex-1 px-2 py-1 rounded-md border text-xs ' +
              (active === l.code
                ? 'border-primary text-primary'
                : 'border-border text-neutral-light/60 hover:text-neutral-light')
            }
            aria-label={`Switch to ${l.label}`}
            aria-pressed={active === l.code}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
