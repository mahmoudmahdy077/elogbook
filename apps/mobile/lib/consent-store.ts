/**
 * Consent store — the approved adapter for `consent_records` writes.
 *
 * Reads are owner-scoped by RLS. Writes go through `set_user_consent`, the
 * SECURITY DEFINER RPC that verifies tenant membership and records the
 * grant/revoke with the user's auth id (the table's raw insert policy does
 * not constrain tenant_id).
 */

import { supabase } from './supabase';

export const CONSENT_TYPES = [
  {
    key: 'data_processing',
    label: 'Data processing',
    description: 'Allow E-Logbook to process your case data for accreditation reporting.',
  },
  {
    key: 'ai_insights',
    label: 'AI insights',
    description: 'Allow E-Logbook to summarize your cases with AI.',
  },
  {
    key: 'data_export',
    label: 'Data export',
    description: 'Allow exporting your data as PDF or CSV.',
  },
  {
    key: 'marketing',
    label: 'Product updates',
    description: 'Receive occasional product update emails.',
  },
  {
    key: 'research',
    label: 'Research participation',
    description: 'Include anonymized data in tenant research aggregates.',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    description: 'Allow privacy-respecting analytics to record feature usage.',
  },
  {
    key: 'data_sharing',
    label: 'Data sharing',
    description: 'Allow sharing de-identified data with partner institutions.',
  },
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number]['key'];

export async function listConsent(
  tenantId: string,
): Promise<{ granted: Partial<Record<ConsentType, boolean>>; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { granted: {}, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('consent_records')
    .select('consent_type, granted_at, revoked_at')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .order('granted_at', { ascending: false });

  if (error) return { granted: {}, error: error.message };

  const granted: Partial<Record<ConsentType, boolean>> = {};
  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<{
    consent_type: string;
    revoked_at: string | null;
  }>) {
    if (seen.has(row.consent_type)) continue;
    seen.add(row.consent_type);
    granted[row.consent_type as ConsentType] = row.revoked_at === null;
  }
  return { granted, error: null };
}

export async function setConsent(
  tenantId: string,
  consentType: ConsentType,
  grant: boolean,
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.rpc('set_user_consent', {
    p_tenant_id: tenantId,
    p_consent_type: consentType,
    p_grant: grant,
  });
  return error ? { ok: false, error: error.message } : { ok: true, error: null };
}
