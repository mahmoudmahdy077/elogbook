'use client';

import { useState } from 'react';
import {
  MOBILE_FEATURES,
  type MobileFeatureKey,
  type MobileRemoteConfig,
} from '@elogbook/shared';

interface Props {
  tenantSlug: string;
  initialConfig: MobileRemoteConfig;
  initialDevices: number;
}

const ROLES = [
  { value: 'all', label: 'Everyone in the tenant' },
  { value: 'resident', label: 'Residents' },
  { value: 'supervisor', label: 'Supervisors' },
  { value: 'director', label: 'Directors' },
  { value: 'institution_admin', label: 'Institution admins' },
] as const;

function isoDatePart(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export default function MobileAppPanel({ tenantSlug, initialConfig, initialDevices }: Props) {
  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const feature of MOBILE_FEATURES) {
      initial[feature.key] = initialConfig.enabled_features[feature.key] !== false;
    }
    return initial;
  });
  const [maintenanceMode, setMaintenanceMode] = useState(initialConfig.maintenance_mode);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    initialConfig.maintenance_message ?? '',
  );
  const [minVersion, setMinVersion] = useState(initialConfig.min_app_version ?? '');
  const [latestVersion, setLatestVersion] = useState(initialConfig.latest_app_version ?? '');
  const [forceUpdate, setForceUpdate] = useState(initialConfig.force_update);
  const [updateUrl, setUpdateUrl] = useState(initialConfig.update_url ?? '');

  const [announcementTitle, setAnnouncementTitle] = useState(
    initialConfig.announcement?.title ?? '',
  );
  const [announcementBody, setAnnouncementBody] = useState(initialConfig.announcement?.body ?? '');
  const [announcementSeverity, setAnnouncementSeverity] = useState(
    initialConfig.announcement?.severity ?? 'info',
  );
  const [announcementExpiry, setAnnouncementExpiry] = useState(
    isoDatePart(initialConfig.announcement?.expires_at ?? null),
  );

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushRole, setPushRole] = useState<(typeof ROLES)[number]['value']>('all');
  const [pushConfirm, setPushConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [pushMessage, setPushMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [devices, setDevices] = useState(initialDevices);

  const toggleFeature = (key: MobileFeatureKey) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const save = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const expiresAt = announcementExpiry
        ? new Date(`${announcementExpiry}T23:59:59.000Z`).toISOString()
        : null;
      const announcement =
        announcementTitle.trim() && announcementBody.trim()
          ? {
              title: announcementTitle.trim(),
              body: announcementBody.trim(),
              severity: announcementSeverity,
              expires_at: expiresAt,
            }
          : null;

      const res = await fetch(`/api/${tenantSlug}/admin/mobile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          config: {
            enabled_features: features,
            maintenance_mode: maintenanceMode,
            maintenance_message: maintenanceMessage.trim() || null,
            min_app_version: minVersion.trim() || null,
            latest_app_version: latestVersion.trim() || null,
            force_update: forceUpdate,
            update_url: updateUrl.trim() || null,
            announcement,
          },
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveMessage({ ok: false, text: data.error ?? 'Could not save the mobile settings.' });
      } else {
        setSaveMessage({
          ok: true,
          text: 'Saved. Devices apply this on next launch or foreground.',
        });
      }
    } catch {
      setSaveMessage({ ok: false, text: 'Network error. Nothing was saved.' });
    } finally {
      setSaving(false);
    }
  };

  const broadcast = async () => {
    if (!pushConfirm) {
      setPushConfirm(true);
      setPushMessage(null);
      return;
    }
    setSending(true);
    setPushMessage(null);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/mobile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'broadcast',
          title: pushTitle.trim(),
          body: pushBody.trim(),
          role: pushRole,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        devices?: number;
        sent?: number;
        failed?: number;
      };
      if (!res.ok) {
        setPushMessage({ ok: false, text: data.error ?? 'Could not send the notification.' });
      } else {
        setDevices(data.devices ?? devices);
        setPushMessage({
          ok: true,
          text: `Sent ${data.sent ?? 0} of ${data.devices ?? 0} device(s)${
            data.failed ? `, ${data.failed} failed` : ''
          }.`,
        });
        setPushTitle('');
        setPushBody('');
      }
    } catch {
      setPushMessage({ ok: false, text: 'Network error. Nothing was sent.' });
    } finally {
      setSending(false);
      setPushConfirm(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-lg font-heading font-semibold">Modules</h2>
          <span className="text-xs text-text-muted">{devices} registered device(s)</span>
        </div>
        <p className="text-sm text-text-muted mb-4">
          Turning a module off removes it from the app menu and blocks its tab. The data stays
          intact; this is presentation only, never an access control.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MOBILE_FEATURES.map((feature) => (
            <label
              key={feature.key}
              className="flex items-start gap-3 rounded-xl border border-border p-3 cursor-pointer hover:bg-backdrop transition-colors"
            >
              <input
                type="checkbox"
                checked={features[feature.key] !== false}
                onChange={() => toggleFeature(feature.key)}
                className="mt-1 h-4 w-4 rounded border-border accent-primary"
              />
              <span>
                <span className="block text-sm font-medium text-text-primary">{feature.label}</span>
                <span className="block text-xs text-text-muted mt-0.5">{feature.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-heading font-semibold mb-1">Availability</h2>
        <p className="text-sm text-text-muted mb-4">
          Maintenance blocks every phone session behind your message. Use it for an incident, not
          for routine updates.
        </p>

        <label className="flex items-center gap-3 mb-3">
          <input
            type="checkbox"
            checked={maintenanceMode}
            onChange={(e) => setMaintenanceMode(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className="text-sm text-text-primary">Maintenance mode</span>
        </label>

        <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="maintenance-message">
          Maintenance message
        </label>
        <textarea
          id="maintenance-message"
          value={maintenanceMessage}
          onChange={(e) => setMaintenanceMessage(e.target.value.slice(0, 500))}
          rows={2}
          placeholder="The app is undergoing scheduled maintenance. Please try again shortly."
          className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none mb-2"
        />
        <p className="text-xs text-text-muted">{maintenanceMessage.length}/500</p>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-heading font-semibold mb-1">Version gate</h2>
        <p className="text-sm text-text-muted mb-4">
          The installed app version comes from its store build. A forced update below the minimum
          blocks the app until the user updates.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="min-version">
              Minimum supported version
            </label>
            <input
              id="min-version"
              value={minVersion}
              onChange={(e) => setMinVersion(e.target.value)}
              placeholder="1.0.0"
              inputMode="numeric"
              className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="latest-version">
              Latest published version
            </label>
            <input
              id="latest-version"
              value={latestVersion}
              onChange={(e) => setLatestVersion(e.target.value)}
              placeholder="1.1.0"
              inputMode="numeric"
              className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <label className="flex items-center gap-3 mt-4 mb-3">
          <input
            type="checkbox"
            checked={forceUpdate}
            onChange={(e) => setForceUpdate(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className="text-sm text-text-primary">Force update below the minimum</span>
        </label>

        <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="update-url">
          Update link
        </label>
        <input
          id="update-url"
          value={updateUrl}
          onChange={(e) => setUpdateUrl(e.target.value)}
          placeholder="https://apps.apple.com/app/id000000000"
          className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <p className="text-xs text-text-muted mt-1">Must start with https://.</p>
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-heading font-semibold mb-1">Announcement</h2>
        <p className="text-sm text-text-muted mb-4">
          A dismissible banner on the app dashboard. Leave both fields empty to remove it. An
          expiry date hides it automatically.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="ann-title">
              Title
            </label>
            <input
              id="ann-title"
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value.slice(0, 120))}
              className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="ann-body">
              Message
            </label>
            <textarea
              id="ann-body"
              value={announcementBody}
              onChange={(e) => setAnnouncementBody(e.target.value.slice(0, 1000))}
              rows={3}
              className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="ann-severity">
                Severity
              </label>
              <select
                id="ann-severity"
                value={announcementSeverity}
                onChange={(e) =>
                  setAnnouncementSeverity(e.target.value as 'info' | 'warning' | 'critical')
                }
                className="w-full px-3 py-2 text-sm text-text-primary bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="ann-expiry">
                Ends
              </label>
              <input
                id="ann-expiry"
                type="date"
                value={announcementExpiry}
                onChange={(e) => setAnnouncementExpiry(e.target.value)}
                className="w-full px-3 py-2 text-sm text-text-primary bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center min-h-[44px] rounded-full bg-primary px-5 text-sm font-medium text-text-on-primary hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save app settings'}
        </button>
        {saveMessage && (
          <p
            role="status"
            className={`text-sm ${saveMessage.ok ? 'text-fg-success' : 'text-fg-danger'}`}
          >
            {saveMessage.text}
          </p>
        )}
      </div>

      <section className="panel p-5">
        <h2 className="text-lg font-heading font-semibold mb-1">Push notification</h2>
        <p className="text-sm text-text-muted mb-4">
          Sends through each device&apos;s Expo push token. {devices} device(s) currently
          registered; uninstalled devices are pruned automatically after a failed delivery.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="push-title">
              Title
            </label>
            <input
              id="push-title"
              value={pushTitle}
              onChange={(e) => {
                setPushTitle(e.target.value.slice(0, 120));
                setPushConfirm(false);
              }}
              className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="push-body">
              Message
            </label>
            <textarea
              id="push-body"
              value={pushBody}
              onChange={(e) => {
                setPushBody(e.target.value.slice(0, 500));
                setPushConfirm(false);
              }}
              rows={2}
              className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="push-role">
              Audience
            </label>
            <select
              id="push-role"
              value={pushRole}
              onChange={(e) => {
                setPushRole(e.target.value as (typeof ROLES)[number]['value']);
                setPushConfirm(false);
              }}
              className="w-full px-3 py-2 text-sm text-text-primary bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={broadcast}
            disabled={sending || !pushTitle.trim() || !pushBody.trim()}
            className={`inline-flex items-center min-h-[44px] rounded-full px-5 text-sm font-medium transition-opacity disabled:opacity-50 ${
              pushConfirm ? 'bg-danger-700 text-white' : 'bg-primary text-text-on-primary'
            }`}
          >
            {sending ? 'Sending…' : pushConfirm ? 'Confirm send' : 'Send notification'}
          </button>
          {pushConfirm && (
            <p className="text-xs text-fg-warning" role="alert">
              Click again to send to {pushRole === 'all' ? 'every registered device' : pushRole.replace('_', ' ')}.
            </p>
          )}
          {pushMessage && (
            <p
              role="status"
              className={`text-sm ${pushMessage.ok ? 'text-fg-success' : 'text-fg-danger'}`}
            >
              {pushMessage.text}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
