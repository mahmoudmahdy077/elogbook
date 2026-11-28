import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOBILE_REMOTE_CONFIG,
  activeAnnouncement,
  compareAppVersions,
  isMobileFeatureEnabled,
  mobileUpdateRequired,
  parseMobileRemoteConfig,
  mergeMobileRemoteConfigs,
  parsePlatformMobileConfig,
} from '../mobile-config';

describe('mobile remote config contract', () => {
  it('defaults every module to enabled', () => {
    expect(isMobileFeatureEnabled(DEFAULT_MOBILE_REMOTE_CONFIG, 'approvals')).toBe(true);
    expect(isMobileFeatureEnabled(DEFAULT_MOBILE_REMOTE_CONFIG, 'ai_insights')).toBe(true);
  });

  it('disables a module only when explicitly false', () => {
    const config = parseMobileRemoteConfig({ enabled_features: { approvals: false } });
    expect(isMobileFeatureEnabled(config, 'approvals')).toBe(false);
    expect(isMobileFeatureEnabled(config, 'milestones')).toBe(true);
  });

  it('ignores unknown feature keys and non-boolean values', () => {
    const config = parseMobileRemoteConfig({
      enabled_features: { mystery_module: false, approvals: 'no' },
    });
    expect(config.enabled_features).toEqual({});
  });

  it('rejects malformed versions instead of comparing garbage', () => {
    const config = parseMobileRemoteConfig({ min_app_version: 'v1', latest_app_version: '1.2' });
    expect(config.min_app_version).toBeNull();
    expect(config.latest_app_version).toBeNull();
  });

  it('compares semantic versions numerically', () => {
    expect(compareAppVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareAppVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareAppVersions('1.0.1', '1.0.10')).toBeLessThan(0);
  });

  it('forces an update only below the minimum when enabled', () => {
    const config = parseMobileRemoteConfig({
      force_update: true,
      min_app_version: '1.4.0',
    });
    expect(mobileUpdateRequired(config, '1.3.9')).toBe(true);
    expect(mobileUpdateRequired(config, '1.4.0')).toBe(false);
    expect(mobileUpdateRequired({ force_update: false, min_app_version: '1.4.0' }, '1.0.0')).toBe(
      false,
    );
  });

  it('drops an expired or dismissed announcement', () => {
    const config = parseMobileRemoteConfig({
      announcement: {
        id: 'a1',
        title: 'Maintenance',
        body: 'Tonight 22:00',
        severity: 'warning',
        expires_at: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(activeAnnouncement(config, Date.parse('2025-12-31T00:00:00Z'))).not.toBeNull();
    expect(activeAnnouncement(config, Date.parse('2026-01-02T00:00:00Z'))).toBeNull();
    expect(
      activeAnnouncement(config, Date.parse('2025-12-31T00:00:00Z'), ['a1']),
    ).toBeNull();
  });

  it('merges platform controls as a floor over tenant controls', () => {
    const platform = parsePlatformMobileConfig({
      maintenance_mode: true,
      maintenance_message: 'Estate-wide outage',
      min_app_version: '2.0.0',
      force_update: true,
      announcement: { id: 'p1', title: 'Global', body: 'Notice', severity: 'info' },
    });
    const tenant = parseMobileRemoteConfig({
      maintenance_mode: false,
      min_app_version: '1.5.0',
      force_update: false,
      announcement: { id: 't1', title: 'Tenant', body: 'Local', severity: 'warning' },
    });
    const merged = mergeMobileRemoteConfigs(platform, tenant);
    expect(merged.maintenance_mode).toBe(true);
    expect(merged.maintenance_message).toBe('Estate-wide outage');
    expect(merged.min_app_version).toBe('2.0.0');
    expect(merged.force_update).toBe(true);
    // A tenant announcement takes precedence over the global one.
    expect(merged.announcement?.id).toBe('t1');
  });

  it('leaves the tenant config unchanged without platform controls', () => {
    const tenant = parseMobileRemoteConfig({ min_app_version: '1.1.0' });
    expect(mergeMobileRemoteConfigs(null, tenant)).toEqual(tenant);
  });

  it('normalises an unknown severity to info', () => {
    const config = parseMobileRemoteConfig({
      announcement: { title: 'Hi', body: 'There', severity: 'purple' },
    });
    expect(config.announcement?.severity).toBe('info');
  });
});
