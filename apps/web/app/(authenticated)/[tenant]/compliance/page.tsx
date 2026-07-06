import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ComplianceReports from '@/components/ComplianceReports';
import type {
  ComplianceData,
  DataAccessSummary,
  PhiInventoryRow,
  ConsentSummary,
  RetentionSummary,
} from '@/components/ComplianceReports';
import type { SupabaseClient } from '@supabase/supabase-js';

const ALLOWED_ROLES: UserRole[] = ['director', 'institution_admin', 'admin'];

export default async function CompliancePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  if (!ALLOWED_ROLES.includes(auth.profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  const supabase: SupabaseClient = await createServerSupabase();
  const tenantId = auth.profile.tenant_id;

  // ---- Fetch all compliance data in parallel ----
  const [dataAccess, phiInventory, consentTracking, retention] = await Promise.all([
    fetchDataAccessData(supabase, tenantId),
    fetchPhiInventory(supabase, tenantId),
    fetchConsentData(supabase, tenantId),
    fetchRetentionData(supabase, tenantId),
  ]);

  const data: ComplianceData = {
    tenantSlug,
    dataAccess,
    phiInventory,
    consentTracking,
    retention,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1 text-[#000000]">Compliance Reports</h1>
      <p className="text-sm text-text-muted mb-6">
        HIPAA / GDPR / SCFHS compliance overview for {auth.tenant.slug}
      </p>
      <ComplianceReports data={data} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data Access Report                                                 */
/* ------------------------------------------------------------------ */

async function fetchDataAccessData(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<DataAccessSummary> {
  // Total count
  const { count: totalCount } = await supabase
    .from('audit_logs')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  // Recent events
  const { data: recent } = await supabase
    .from('audit_logs')
    .select('id, created_at, action, resource_type, resource_id, user_id, ip_address')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20);

  // Fetch more rows for breakdown (up to 10k)
  const { data: allLogs } = await supabase
    .from('audit_logs')
    .select('action, resource_type')
    .eq('tenant_id', tenantId)
    .limit(10_000);

  // Build byAction map
  const actionMap = new Map<string, number>();
  const resourceMap = new Map<string, number>();
  for (const log of allLogs ?? []) {
    actionMap.set(log.action as string, (actionMap.get(log.action as string) ?? 0) + 1);
    resourceMap.set(log.resource_type as string, (resourceMap.get(log.resource_type as string) ?? 0) + 1);
  }

  const byAction = Array.from(actionMap.entries())
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count);

  const byResource = Array.from(resourceMap.entries())
    .map(([resource_type, count]) => ({ resource_type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalAccessEvents: totalCount ?? 0,
    byAction,
    byResource,
    recentEvents: (recent ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      created_at: r.created_at as string,
      action: r.action as string,
      resource_type: r.resource_type as string,
      resource_id: r.resource_id as string | null,
      user_id: r.user_id as string | null,
      ip_address: r.ip_address as string | null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  PHI Inventory                                                      */
/* ------------------------------------------------------------------ */

async function fetchPhiInventory(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PhiInventoryRow[]> {
  // case_entries: fetch all to check is_deidentified
  const { data: entries } = await supabase
    .from('case_entries')
    .select('is_deidentified')
    .eq('tenant_id', tenantId);

  const totalCaseEntries = entries?.length ?? 0;
  const phiPresent = entries?.filter((c: Record<string, unknown>) => c.is_deidentified === false).length ?? 0;
  const phiRedacted = entries?.filter((c: Record<string, unknown>) => c.is_deidentified === true).length ?? 0;

  const rows: PhiInventoryRow[] = [];

  if (totalCaseEntries > 0) {
    rows.push({
      table_name: 'case_entries',
      total_records: totalCaseEntries,
      phi_present: phiPresent,
      phi_redacted: phiRedacted,
      phi_percentage: totalCaseEntries > 0 ? (phiPresent / totalCaseEntries) * 100 : 0,
    });
  }

  // profiles: all contain PII/PHI
  const { count: profileCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (profileCount && profileCount > 0) {
    rows.push({
      table_name: 'profiles',
      total_records: profileCount,
      phi_present: profileCount,
      phi_redacted: 0,
      phi_percentage: 100,
    });
  }

  // consent_records
  const { count: consentCount } = await supabase
    .from('consent_records')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  if (consentCount && consentCount > 0) {
    rows.push({
      table_name: 'consent_records',
      total_records: consentCount,
      phi_present: consentCount,
      phi_redacted: 0,
      phi_percentage: 100,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Consent Tracking                                                   */
/* ------------------------------------------------------------------ */

async function fetchConsentData(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ConsentSummary> {
  const [{ count: total }, { data: allRecords }, { data: recent }] = await Promise.all([
    supabase
      .from('consent_records')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase
      .from('consent_records')
      .select('consent_type, revoked_at')
      .eq('tenant_id', tenantId),
    supabase
      .from('consent_records')
      .select('id, consent_type, granted_at, revoked_at, version')
      .eq('tenant_id', tenantId)
      .order('granted_at', { ascending: false })
      .limit(20),
  ]);

  const byTypeMap = new Map<string, { consent_type: string; granted: number; revoked: number }>();

  for (const rec of allRecords ?? []) {
    const entry = byTypeMap.get(rec.consent_type as string) ?? {
      consent_type: rec.consent_type as string,
      granted: 0,
      revoked: 0,
    };
    if (rec.revoked_at) {
      entry.revoked++;
    } else {
      entry.granted++;
    }
    byTypeMap.set(rec.consent_type as string, entry);
  }

  return {
    total: total ?? 0,
    byType: Array.from(byTypeMap.values()),
    recent: (recent ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      consent_type: r.consent_type as string,
      granted_at: r.granted_at as string,
      revoked_at: r.revoked_at as string | null,
      version: r.version as string,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Retention Status                                                   */
/* ------------------------------------------------------------------ */

async function fetchRetentionData(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RetentionSummary> {
  const [{ count: totalCaseEntries }, { count: softDeletedCases }] = await Promise.all([
    supabase
      .from('case_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase
      .from('case_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('deleted_at', 'is', null),
  ]);

  const activeCases = (totalCaseEntries ?? 0) - (softDeletedCases ?? 0);
  const deletedCounts: { table_name: string; deleted_count: number }[] = [];

  if (softDeletedCases && softDeletedCases > 0) {
    deletedCounts.push({ table_name: 'case_entries', deleted_count: softDeletedCases });
  }

  // Check profiles
  const { count: deletedProfiles } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('deleted_at', 'is', null);

  if (deletedProfiles && deletedProfiles > 0) {
    deletedCounts.push({ table_name: 'profiles', deleted_count: deletedProfiles });
  }

  // Check case_templates
  const { count: deletedTemplates } = await supabase
    .from('case_templates')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .not('deleted_at', 'is', null);

  if (deletedTemplates && deletedTemplates > 0) {
    deletedCounts.push({ table_name: 'case_templates', deleted_count: deletedTemplates });
  }

  return {
    softDeletedRecords: softDeletedCases ?? 0,
    activeRecords: activeCases,
    totalRecords: totalCaseEntries ?? 0,
    pendingCleanup: softDeletedCases ?? 0,
    byTable: deletedCounts,
  };
}
