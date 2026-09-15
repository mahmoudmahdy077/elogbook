/**
 * M6 — accessibility helpers (local-first).
 * Static contract + resident-understandable copy. Full WCAG requires
 * automation + manual TalkBack/VoiceOver + screenshots per release
 * (see docs/upgrade/evidence/mobile/perf-budgets.md).
 * N7.4: status copy resolves through the centralized copy table.
 */

import { t } from './copy';

export function auditLabels(items: Array<{ id: string; label: string | null | undefined }>): string[] {
  return items.filter((i) => !i.label || i.label.trim().length === 0).map((i) => i.id);
}

export function offlineStatusCopy(
  status: 'offline' | 'syncing' | 'synced' | 'error' | 'idle',
  locale = 'en',
): string {
  switch (status) {
    case 'offline':
      return t('offline.banner', locale);
    case 'syncing':
      return t('sync.sending', locale);
    case 'synced':
      return t('sync.sent', locale);
    case 'error':
      return t('sync.attention', locale);
    default:
      return t('sync.ready', locale);
  }
}
