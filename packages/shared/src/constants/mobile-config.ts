/**
 * Mobile app control plane contract (web ↔ Expo app).
 *
 * The web admin edits `mobile_app_config`; the app reads it through RLS and
 * applies it on boot and on every foreground. Keep this file the single
 * source of truth: the SQL CHECK constraints, the admin form, and the app
 * gate all import these keys.
 */

export const MOBILE_FEATURE_KEYS = [
  'my_cases',
  'log_case',
  'approvals',
  'rotations',
  'ai_insights',
  'duty_hours',
  'evaluations',
  'milestones',
  'reflections',
  'analytics',
  'attachments',
] as const;

export type MobileFeatureKey = (typeof MOBILE_FEATURE_KEYS)[number];

export interface MobileFeatureDefinition {
  key: MobileFeatureKey;
  label: string;
  description: string;
}

export const MOBILE_FEATURES: ReadonlyArray<MobileFeatureDefinition> = [
  { key: 'my_cases', label: 'My Cases', description: 'Resident case list and case detail' },
  { key: 'log_case', label: 'Log Case', description: 'New case capture and draft editing' },
  { key: 'approvals', label: 'Approvals', description: 'Supervisor review queue' },
  { key: 'rotations', label: 'Rotations', description: 'Rotation schedule and assignments' },
  { key: 'ai_insights', label: 'AI Insights', description: 'AI gap analysis and suggestions' },
  { key: 'duty_hours', label: 'Duty Hours', description: 'Shift logging and weekly totals' },
  { key: 'evaluations', label: 'Evaluations', description: 'Mini-CEX / DOPS / CBD forms' },
  { key: 'milestones', label: 'Milestones', description: 'Competency milestone progress' },
  { key: 'reflections', label: 'Reflections', description: 'Written reflective entries' },
  { key: 'analytics', label: 'Analytics', description: 'Case and progress charts' },
  { key: 'attachments', label: 'Attachments', description: 'Case photo uploads' },
];

export type MobileAnnouncementSeverity = 'info' | 'warning' | 'critical';

export interface MobileAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: MobileAnnouncementSeverity;
  expires_at: string | null;
}

export interface MobileRemoteConfig {
  enabled_features: Partial<Record<MobileFeatureKey, boolean>>;
  maintenance_mode: boolean;
  maintenance_message: string | null;
  min_app_version: string | null;
  latest_app_version: string | null;
  force_update: boolean;
  update_url: string | null;
  announcement: MobileAnnouncement | null;
}

export const DEFAULT_MAINTENANCE_MESSAGE =
  'The app is undergoing scheduled maintenance. Please try again shortly.';

export const DEFAULT_MOBILE_REMOTE_CONFIG: MobileRemoteConfig = {
  enabled_features: {},
  maintenance_mode: false,
  maintenance_message: null,
  min_app_version: null,
  latest_app_version: null,
  force_update: false,
  update_url: null,
  announcement: null,
};

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const MAX_MESSAGE = 500;
const MAX_TITLE = 120;
const MAX_BODY = 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isMobileFeatureKey(value: string): value is MobileFeatureKey {
  return (MOBILE_FEATURE_KEYS as ReadonlyArray<string>).includes(value);
}

export function parseMobileRemoteConfig(row: unknown): MobileRemoteConfig {
  const record = asRecord(row);
  if (!record) return { ...DEFAULT_MOBILE_REMOTE_CONFIG };

  const features: Partial<Record<MobileFeatureKey, boolean>> = {};
  const rawFeatures = asRecord(record.enabled_features);
  if (rawFeatures) {
    for (const key of MOBILE_FEATURE_KEYS) {
      if (typeof rawFeatures[key] === 'boolean') features[key] = rawFeatures[key] as boolean;
    }
  }

  const maintenanceMessage =
    typeof record.maintenance_message === 'string'
      ? record.maintenance_message.slice(0, MAX_MESSAGE)
      : null;

  const minVersion =
    typeof record.min_app_version === 'string' && VERSION_RE.test(record.min_app_version)
      ? record.min_app_version
      : null;
  const latestVersion =
    typeof record.latest_app_version === 'string' && VERSION_RE.test(record.latest_app_version)
      ? record.latest_app_version
      : null;

  const rawAnnouncement = asRecord(record.announcement);
  let announcement: MobileAnnouncement | null = null;
  if (rawAnnouncement) {
    const title = typeof rawAnnouncement.title === 'string' ? rawAnnouncement.title.trim() : '';
    const body = typeof rawAnnouncement.body === 'string' ? rawAnnouncement.body.trim() : '';
    if (title && body) {
      const severity = rawAnnouncement.severity;
      announcement = {
        id:
          typeof rawAnnouncement.id === 'string' && rawAnnouncement.id
            ? rawAnnouncement.id
            : `${Date.now()}`,
        title: title.slice(0, MAX_TITLE),
        body: body.slice(0, MAX_BODY),
        severity:
          severity === 'warning' || severity === 'critical' ? severity : 'info',
        expires_at:
          typeof rawAnnouncement.expires_at === 'string' ? rawAnnouncement.expires_at : null,
      };
    }
  }

  return {
    enabled_features: features,
    maintenance_mode: record.maintenance_mode === true,
    maintenance_message: maintenanceMessage,
    min_app_version: minVersion,
    latest_app_version: latestVersion,
    force_update: record.force_update === true,
    update_url: typeof record.update_url === 'string' ? record.update_url : null,
    announcement,
  };
}

/** Features default to ON; only an explicit `false` disables one. */
export function isMobileFeatureEnabled(
  config: Pick<MobileRemoteConfig, 'enabled_features'>,
  key: MobileFeatureKey,
): boolean {
  return config.enabled_features?.[key] !== false;
}

/** Numeric semver comparison (major.minor.patch). Returns <0, 0, >0. */
export function compareAppVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const parts = v.split('.').slice(0, 3).map((p) => Number.parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts;
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function mobileUpdateRequired(
  config: Pick<MobileRemoteConfig, 'force_update' | 'min_app_version'>,
  currentVersion: string,
): boolean {
  if (!config.force_update || !config.min_app_version) return false;
  if (!VERSION_RE.test(config.min_app_version)) return false;
  return compareAppVersions(currentVersion, config.min_app_version) < 0;
}

export interface AnnouncementState {
  id: string;
  title: string;
  body: string;
  severity: MobileAnnouncementSeverity;
}

/** Returns the announcement when present, unexpired and not dismissed. */
export function activeAnnouncement(
  config: Pick<MobileRemoteConfig, 'announcement'>,
  now: number = Date.now(),
  dismissedIds: ReadonlyArray<string> = [],
): AnnouncementState | null {
  const announcement = config.announcement;
  if (!announcement) return null;
  if (dismissedIds.includes(announcement.id)) return null;
  if (announcement.expires_at) {
    const expiry = Date.parse(announcement.expires_at);
    if (Number.isFinite(expiry) && expiry <= now) return null;
  }
  return {
    id: announcement.id,
    title: announcement.title,
    body: announcement.body,
    severity: announcement.severity,
  };
}
