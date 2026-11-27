import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOBILE_REMOTE_CONFIG,
  activeAnnouncement,
  compareAppVersions,
  isMobileFeatureEnabled,
  mobileUpdateRequired,
  parseMobileRemoteConfig,
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

  it('normalises an unknown severity to info', () => {
    const config = parseMobileRemoteConfig({
      announcement: { title: 'Hi', body: 'There', severity: 'purple' },
    });
    expect(config.announcement?.severity).toBe('info');
  });
});
