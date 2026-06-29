import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';

import en from '../locales/en.json';
import ar from '../locales/ar.json';

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';
export const RTL_LOCALES: ReadonlyArray<SupportedLocale> = ['ar'];

const RTL_SET = new Set<string>(RTL_LOCALES);

export function isRtlLocale(locale: string): boolean {
  return RTL_SET.has(locale);
}

export function detectDeviceLocale(): SupportedLocale {
  const locales = Localization.getLocales();
  for (const l of locales) {
    const tag = (l.languageCode ?? '').toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(tag)) {
      return tag as SupportedLocale;
    }
  }
  return DEFAULT_LOCALE;
}

let i18nInstance: I18n | null = null;

export function getI18n(): I18n {
  if (i18nInstance) return i18nInstance;
  const i18n = new I18n({ en, ar });
  i18n.defaultLocale = DEFAULT_LOCALE;
  i18n.enableFallback = true;
  i18n.locale = detectDeviceLocale();
  i18nInstance = i18n;
  return i18n;
}

export function setLocale(locale: SupportedLocale): void {
  const i18n = getI18n();
  i18n.locale = locale;
}

export function t(key: string, options?: Record<string, unknown>): string {
  return getI18n().t(key, options);
}
