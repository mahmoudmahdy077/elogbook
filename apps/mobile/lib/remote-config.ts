/**
 * Remote configuration for the mobile app, controlled from the web admin
 * ("Admin → Mobile App"). The app fetches `mobile_app_config` through RLS and
 * caches it per tenant, so a cold start with no network still applies the last
 * known controls instead of resetting to defaults mid-incident.
 *
 * Presentation only: hiding a module never grants or removes data access.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mergeMobileRemoteConfigs,
  parseMobileRemoteConfig,
  parsePlatformMobileConfig,
  type MobileRemoteConfig,
} from '@elogbook/shared';
import { supabase } from './supabase';
import { logWarn } from './logger';

export interface RemoteConfigSnapshot {
  tenantId: string | null;
  config: MobileRemoteConfig;
  institutionName: string | null;
  primaryColor: string | null;
  fetchedAt: number;
}

const CACHE_KEY = 'mobile.remote_config.v2';
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const EMPTY_REMOTE_CONFIG: RemoteConfigSnapshot = {
  tenantId: null,
  config: parseMobileRemoteConfig(null),
  institutionName: null,
  primaryColor: null,
  fetchedAt: 0,
};

interface CachedShape {
  tenant_id: string;
  config: MobileRemoteConfig;
  institution_name: string | null;
  primary_color: string | null;
  fetched_at: number;
}

function cacheKeyFor(tenantId: string): string {
  return `${CACHE_KEY}.${tenantId}`;
}

export async function loadCachedRemoteConfig(
  tenantId: string,
): Promise<RemoteConfigSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKeyFor(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedShape>;
    if (parsed.tenant_id !== tenantId) return null;
    return {
      tenantId,
      config: parseMobileRemoteConfig(parsed.config),
      institutionName: parsed.institution_name ?? null,
      primaryColor:
        typeof parsed.primary_color === 'string' && HEX_RE.test(parsed.primary_color)
          ? parsed.primary_color
          : null,
      fetchedAt: typeof parsed.fetched_at === 'number' ? parsed.fetched_at : 0,
    };
  } catch {
    return null;
  }
}

async function saveCache(snapshot: RemoteConfigSnapshot): Promise<void> {
  if (!snapshot.tenantId) return;
  try {
    const payload: CachedShape = {
      tenant_id: snapshot.tenantId,
      config: snapshot.config,
      institution_name: snapshot.institutionName,
      primary_color: snapshot.primaryColor,
      fetched_at: snapshot.fetchedAt,
    };
    await AsyncStorage.setItem(cacheKeyFor(snapshot.tenantId), JSON.stringify(payload));
  } catch {
    // Cache is best-effort; a failed write must not break the app.
  }
}

export async function fetchRemoteConfig(
  tenantId: string,
): Promise<RemoteConfigSnapshot> {
  const fetchedAt = Date.now();
  const { data: row, error } = await supabase
    .from('mobile_app_config')
    .select(
      'enabled_features, maintenance_mode, maintenance_message, min_app_version, latest_app_version, force_update, update_url, announcement',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    logWarn('remote-config.read-failed', { code: error.code ?? 'unknown' });
    const cached = await loadCachedRemoteConfig(tenantId);
    if (cached) return cached;
    return { ...EMPTY_REMOTE_CONFIG, tenantId, fetchedAt };
  }

  const { data: platformRow } = await supabase
    .from('platform_mobile_config')
    .select(
      'maintenance_mode, maintenance_message, min_app_version, force_update, update_url, announcement',
    )
    .eq('id', true)
    .maybeSingle();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, custom_branding')
    .eq('id', tenantId)
    .maybeSingle();

  const branding = (tenant?.custom_branding ?? null) as Record<string, unknown> | null;
  const primaryColor =
    typeof branding?.primary_color === 'string' && HEX_RE.test(branding.primary_color)
      ? branding.primary_color
      : null;

  const snapshot: RemoteConfigSnapshot = {
    tenantId,
    config: mergeMobileRemoteConfigs(
      parsePlatformMobileConfig(platformRow),
      parseMobileRemoteConfig(row),
    ),
    institutionName:
      typeof tenant?.name === 'string' && tenant.name ? tenant.name : null,
    primaryColor,
    fetchedAt,
  };

  await saveCache(snapshot);
  return snapshot;
}

/** Current tenant from the verified session (app_metadata is server-set). */
export async function currentTenantId(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const tenantId = session?.user?.app_metadata?.tenant_id;
    return typeof tenantId === 'string' ? tenantId : null;
  } catch {
    return null;
  }
}

export async function clearRemoteConfigCache(tenantId: string | null): Promise<void> {
  if (!tenantId) return;
  try {
    await AsyncStorage.removeItem(cacheKeyFor(tenantId));
  } catch {
    // best-effort
  }
}
