/**
 * N7.4 — centralized user-facing copy with locale fallback.
 *
 * New/changed product copy MUST be added here (English source + translations)
 * instead of hardcoded inline strings. Legacy screens remain hardcoded
 * English and are listed in docs/upgrade/evidence/mobile/screen-copy-inventory.md
 * as explicit exceptions pending the full translation pass (ledger-blocked).
 * t() falls back to English for missing locales — never to an empty string.
 */

export type CopyKey =
  | 'offline.savedOnDevice'
  | 'offline.willSend'
  | 'offline.banner'
  | 'sync.sending'
  | 'sync.sent'
  | 'sync.attention'
  | 'session.verifying'
  | 'session.expired'
  | 'denied.suspended'
  | 'denied.generic'
  | 'queue.full'
  | 'mode.mismatch'
  | 'sync.ready';

type Locale = string;

const EN: Record<CopyKey, string> = {
  'offline.savedOnDevice': 'Saved on this device — will send when you are back online.',
  'offline.willSend': 'Will sync when online',
  'offline.banner': 'You are offline. Cases save on this device and send when you are back online.',
  'sync.sending': 'Sending your saved cases…',
  'sync.sent': 'All cases saved and sent.',
  'sync.attention': 'Some cases need your attention. Check your connection and try again.',
  'session.verifying': 'Verifying session…',
  'session.expired': 'Your session expired. Sign in again — your saved work stays on this device.',
  'denied.suspended': 'This account is suspended. Contact your administrator.',
  'denied.generic': 'Not permitted. Check your role and tenant status, then retry.',
  'queue.full': 'Local queue is full. Free space by syncing, then retry.',
  'mode.mismatch': 'This tenant uses a different record mode — switch the case mode and retry. Nothing was saved.',
  'sync.ready': 'Ready.',
};

const AR: Partial<Record<CopyKey, string>> = {
  'offline.savedOnDevice': 'تم الحفظ على هذا الجهاز — سيتم الإرسال عند عودة الاتصال.',
  'offline.willSend': 'ستتم المزامنة عند الاتصال',
  'offline.banner': 'أنت غير متصل. تُحفظ الحالات على هذا الجهاز وتُرسل عند عودة الاتصال.',
  'sync.sending': 'جارٍ إرسال الحالات المحفوظة…',
  'sync.sent': 'تم حفظ جميع الحالات وإرسالها.',
  'sync.attention': 'بعض الحالات تحتاج إلى انتباهك. تحقق من الاتصال وحاول مجددًا.',
  'session.verifying': 'جارٍ التحقق من الجلسة…',
  'session.expired': 'انتهت جلستك. سجّل الدخول مجددًا — عملك المحفوظ يبقى على هذا الجهاز.',
  'denied.suspended': 'هذا الحساب موقوف. تواصل مع المسؤول.',
  'denied.generic': 'غير مسموح. تحقق من دورك وحالة المؤسسة ثم حاول مجددًا.',
  'queue.full': 'قائمة الانتظار المحلية ممتلئة. أخلِ مساحة بالمزامنة ثم حاول مجددًا.',
  'mode.mismatch': 'هذه المؤسسة تستخدم وضع سجلات مختلفًا — بدّل وضع الحالة وحاول مجددًا. لم يُحفظ شيء.',
  'sync.ready': 'جاهز.',
};

const TABLES: Record<string, Partial<Record<CopyKey, string>>> = { en: EN, ar: AR };

export function t(key: CopyKey, locale: Locale): string {
  const lang = locale.toLowerCase().split(/[-_]/)[0];
  return TABLES[lang]?.[key] ?? EN[key];
}

/** Keys missing a translation for the locale (empty = fully translated). */
export function missingKeys(locale: Locale): CopyKey[] {
  const lang = locale.toLowerCase().split(/[-_]/)[0];
  if (lang === 'en') return [];
  const table = TABLES[lang] ?? {};
  return (Object.keys(EN) as CopyKey[]).filter((k) => !(k in table));
}
