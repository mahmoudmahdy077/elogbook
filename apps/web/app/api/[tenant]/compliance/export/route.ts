import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import type { UserRole } from '@/lib/supabase/auth';
import type { SupabaseClient } from '@supabase/supabase-js';

const ALLOWED_ROLES: UserRole[] = ['director', 'institution_admin', 'admin'];

type Section = 'data-access' | 'phi-inventory' | 'consent' | 'retention';

const VALID_SECTIONS: Section[] = ['data-access', 'phi-inventory', 'consent', 'retention'];

/* ================================================================== */
/*  GET /api/[tenant]/compliance/export                                */
/* ================================================================== */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  // ---- CSRF ----
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  // ---- Rate limit ----
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const { allowed, retryAfter } = await checkRateLimit(`compliance-export:${ip}`, 10);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth ----
  const supabase: SupabaseClient = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
  }

  const tenant = profile.tenants as unknown as { slug: string };
  const { tenant: tenantSlug } = await params;

  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!ALLOWED_ROLES.includes(profile.role as UserRole)) {
    return NextResponse.json(
      { error: 'Only directors and admins can export compliance reports' },
      { status: 403 },
    );
  }

  // ---- Parse params ----
  const url = new URL(request.url);
  const section = url.searchParams.get('section') as Section | null;
  const format = url.searchParams.get('format') || 'csv';

  if (!section || !VALID_SECTIONS.includes(section)) {
    return NextResponse.json(
      { error: 'Invalid section. Must be one of: data-access, phi-inventory, consent, retention' },
      { status: 400 },
    );
  }

  if (format !== 'csv' && format !== 'pdf') {
    return NextResponse.json(
      { error: 'format must be "csv" or "pdf"' },
      { status: 400 },
    );
  }

  // ---- Route to section handler ----
  const handlers: Record<Section, () => Promise<{ rows: Record<string, unknown>[]; title: string }>> = {
    'data-access': () => getDataAccessData(supabase, profile.tenant_id as string),
    'phi-inventory': () => getPhiInventoryData(supabase, profile.tenant_id as string),
    'consent': () => getConsentData(supabase, profile.tenant_id as string),
    'retention': () => getRetentionData(supabase, profile.tenant_id as string),
  };

  const { rows, title } = await handlers[section]();

  // ---- Build filename ----
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `compliance-${section}-${dateStr}`;

  // ---- Format response ----
  if (format === 'csv') {
    const csv = toCsv(rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  }

  // PDF → HTML fallback (same pattern as audit export)
  const html = toHtml(title, rows, tenant.slug);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.html"`,
      'X-Export-Format': 'html',
      'X-Export-Note': 'PDF generation unavailable; downloaded as HTML for browser print-to-PDF',
    },
  });
}

/* ================================================================== */
/*  Section data fetchers                                              */
/* ================================================================== */

async function getDataAccessData(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: logs } = await supabase
    .from('audit_logs')
    .select('created_at, action, resource_type, resource_id, user_id, ip_address')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(10_000);

  const rows = (logs ?? []).map((l: Record<string, unknown>) => ({
    created_at: l.created_at as string,
    action: l.action as string,
    resource_type: l.resource_type as string,
    resource_id: (l.resource_id ?? '') as string,
    user_id: (l.user_id ?? '') as string,
    ip_address: (l.ip_address ?? '') as string,
  }));

  return { rows, title: 'Data Access Report' };
}

async function getPhiInventoryData(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: entries } = await supabase
    .from('case_entries')
    .select('is_deidentified')
    .eq('tenant_id', tenantId);

  const total = entries?.length ?? 0;
  const phiPresent = entries?.filter((e: Record<string, unknown>) => e.is_deidentified === false).length ?? 0;
  const phiRedacted = entries?.filter((e: Record<string, unknown>) => e.is_deidentified === true).length ?? 0;

  const { count: profileCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const { count: consentCount } = await supabase
    .from('consent_records')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const rows: Record<string, unknown>[] = [];

  if (total > 0) {
    rows.push({
      table_name: 'case_entries',
      total_records: total,
      phi_present: phiPresent,
      phi_redacted: phiRedacted,
      phi_percentage: ((total > 0 ? phiPresent / total : 0) * 100).toFixed(1),
    });
  }

  if (profileCount && profileCount > 0) {
    rows.push({
      table_name: 'profiles',
      total_records: profileCount,
      phi_present: profileCount,
      phi_redacted: 0,
      phi_percentage: '100.0',
    });
  }

  if (consentCount && consentCount > 0) {
    rows.push({
      table_name: 'consent_records',
      total_records: consentCount,
      phi_present: consentCount,
      phi_redacted: 0,
      phi_percentage: '100.0',
    });
  }

  return { rows, title: 'PHI Inventory' };
}

async function getConsentData(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: records } = await supabase
    .from('consent_records')
    .select('consent_type, granted_at, revoked_at, version, ip_address')
    .eq('tenant_id', tenantId)
    .order('granted_at', { ascending: false })
    .limit(10_000);

  const rows = (records ?? []).map((r: Record<string, unknown>) => ({
    consent_type: r.consent_type as string,
    granted_at: r.granted_at as string,
    revoked_at: (r.revoked_at ?? '') as string,
    version: r.version as string,
    ip_address: (r.ip_address ?? '') as string,
  }));

  return { rows, title: 'Consent Records' };
}

async function getRetentionData(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data: cases } = await supabase
    .from('case_entries')
    .select('id, created_at, deleted_at')
    .eq('tenant_id', tenantId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(10_000);

  const rows = (cases ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    created_at: c.created_at as string,
    deleted_at: c.deleted_at as string,
    status: 'soft-deleted',
  }));

  return { rows, title: 'Retention Status — Soft-Deleted Records' };
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return 'No data';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(','));
  }
  return lines.join('\n');
}

function toHtml(title: string, rows: Record<string, unknown>[], tenantName: string): string {
  if (rows.length === 0) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>No data found.</p></body></html>`;
  }

  const headers = Object.keys(rows[0]!);
  const tableRows = rows
    .map(
      (r) =>
        `<tr>${headers.map((h) => `<td>${escapeHtml(String(r[h] ?? ''))}</td>`).join('')}</tr>`,
    )
    .join('\n      ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} - ${escapeHtml(tenantName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; font-size: 11px; color: #000; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .meta { color: #8E8E93; margin-bottom: 16px; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 6px; border-bottom: 1px solid #E5E5EA; font-weight: 600; color: #8E8E93; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 8px 6px; border-bottom: 1px solid #E5E5EA; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .footer { margin-top: 16px; font-size: 10px; color: #8E8E93; border-top: 1px solid #E5E5EA; padding-top: 8px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${escapeHtml(tenantName)} · ${rows.length} entries</div>
  <table>
    <thead>
      <tr>${headers.map((h) => `<th>${escapeHtml(h.replace(/_/g, ' '))}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <div class="footer">Generated by E-Logbook on ${new Date().toISOString().slice(0, 10)}</div>
</body>
</html>`;

  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
