'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';

const SUPPORTED = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
] as const;

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
      document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    }
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="px-3 py-2 text-xs">
      <div className="text-neutral-light/40 mb-1.5">Language / اللغة</div>
      <div className="flex flex-col gap-1">
        {SUPPORTED.map((l) => (
          <button
            key={l.code}
            onClick={() => switchTo(l.code)}
            disabled={pending}
            className={
              'flex items-center gap-2 px-2 py-1.5 rounded-md border text-xs transition-colors ' +
              (active === l.code
                ? 'border-primary text-primary bg-primary/5'
                : 'border-border text-neutral-light/60 hover:text-neutral-light hover:bg-black/5 dark:hover:bg-white/5')
            }
            aria-label={`Switch to ${l.label}`}
            aria-pressed={active === l.code}
          >
            <span className="text-sm leading-none">{l.flag}</span>
            <span>{l.label}</span>
            {active === l.code && (
              <svg className="w-3 h-3 ml-auto text-primary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
