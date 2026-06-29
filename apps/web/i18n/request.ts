import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export const locales = ['en', 'ar'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const rtlLocales: ReadonlyArray<Locale> = ['ar'];

const RTL_SET = new Set<string>(rtlLocales);

export function isRtl(locale: string): boolean {
  return RTL_SET.has(locale);
}

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  if (cookieLocale && (locales as readonly string[]).includes(cookieLocale)) {
    return cookieLocale as Locale;
  }
  const headerStore = await headers();
  const accept = headerStore.get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase();
    if (!tag) continue;
    const primary = tag.split('-')[0];
    if ((locales as readonly string[]).includes(primary)) {
      return primary as Locale;
    }
  }
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
