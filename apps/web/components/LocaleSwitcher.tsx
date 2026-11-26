'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

const SUPPORTED = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' },
] as const;

/**
 * Compact language picker. The previous version stacked three bordered buttons
 * with flag emoji, which overflowed the sidebar footer and covered the user
 * block on shorter screens.
 */
export default function LocaleSwitcher() {
  const router = useRouter();
  const currentLocale = useLocale();
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState(currentLocale);

  const switchTo = (code: string) => {
    setActive(code);
    document.cookie = `NEXT_LOCALE=${code};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = code;
      // Arabic is not translated yet; keep LTR until the catalogue is wired in.
      document.documentElement.dir = 'ltr';
    }
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <label className="flex items-center gap-2 px-2 py-1 text-xs text-text-muted">
      <span className="sr-only">Language</span>
      <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M7.75 2.75a.75.75 0 00-1.5 0v1.5h-2a.75.75 0 000 1.5h.62a8.5 8.5 0 001.9 4.03 8.6 8.6 0 01-1.6 1.5.75.75 0 10.9 1.2 10.1 10.1 0 001.93-1.83 10.1 10.1 0 001.93 1.83.75.75 0 10.9-1.2 8.6 8.6 0 01-1.6-1.5 8.5 8.5 0 001.9-4.03h.62a.75.75 0 000-1.5h-2v-1.5a.75.75 0 00-1.5 0v1.5H7.75v-1.5zm-1.4 3h5.3a7 7 0 01-1.62 3.24A7 7 0 016.35 5.75z" />
        <path d="M12.9 11.3a.75.75 0 00-1.42 0l-2.75 7a.75.75 0 001.4.55l.72-1.85h2.68l.72 1.85a.75.75 0 001.4-.55l-2.75-7zm.28 4.2h-1.98l.99-2.52.99 2.52z" />
      </svg>
      <select
        value={active}
        disabled={pending}
        onChange={(e) => switchTo(e.target.value)}
        aria-label="Language"
        className="min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-surface-solid px-2 py-1 text-xs text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        {SUPPORTED.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
