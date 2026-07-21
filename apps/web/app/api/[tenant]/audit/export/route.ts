import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import type { UserRole } from '@/lib/supabase/auth';

const ALLOWED_ROLES: UserRole[] = ['director', 'institution_admin', 'admin'];
const MAX_EXPORT_ROWS = 10_000;

interface AuditLogRow {
  id: string;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  user_id: string | null;
  ip_address: string | null;
  changes: Record<string, unknown> | null;
}

/**
 * GET /api/[tenant]/audit/export
 *
 * Exports audit logs as CSV with optional date range filter.
 * Respects tenant isolation — only returns logs for the caller's tenant.
 *
 * Query params:
 *   - startDate: ISO date string (inclusive lower bound)
 *   - endDate: ISO date string (inclusive upper bound)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  // ---- CSRF check ----
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  // ---- Rate limit by IP (10 req/min) ----
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const { allowed, retryAfter } = await checkRateLimit(`audit-export:${ip}`, 10);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth ----
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---- Get caller's profile + tenant ----
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
  }

  const tenant = profile.tenants as { slug: string };
  const { tenant: tenantSlug } = await params;

  // ---- Tenant slug validation ----
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  // ---- Role check ----
  if (!ALLOWED_ROLES.includes(profile.role as UserRole)) {
    return NextResponse.json(
      { error: 'Only directors and admins can export audit logs' },
      { status: 403 },
    );
  }

  // ---- Parse query params ----
  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  // ---- Query audit logs ----
  let query = supabase
    .from('audit_logs')
    .select('id, created_at, action, resource_type, resource_id, user_id, ip_address, changes')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(MAX_EXPORT_ROWS);

  if (startDate) {
    query = query.gte('created_at', startDate);
  }
  if (endDate) {
    query = query.lte('created_at', endDate);
  }

  const { data: logs, error } = await query;

  if (error) {
    console.error('Failed to query audit logs for export', { error: error.message });
    return NextResponse.json(
      { error: 'Failed to retrieve audit logs' },
      { status: 500 },
    );
  }

  const rows = (logs ?? []) as AuditLogRow[];

  // ---- Log the export in the audit trail ----
  await supabase.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'audit_export',
    resource_type: 'audit',
    resource_id: profile.tenant_id,
    changes: {
      row_count: rows.length,
      format: 'csv',
      date_range: { start: startDate ?? null, end: endDate ?? null },
    },
  }).maybeSingle();

  // ---- CSV response ----
  const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
  const csvHeaders = ['id', 'created_at', 'action', 'resource_type', 'resource_id', 'user_id', 'ip_address'];
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(csvHeaders.join(',') + '\n'));
      for (const r of rows) {
        controller.enqueue(encoder.encode(rowToCsv(r) + '\n'));
      }
      controller.close();
    }
  }), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` } });
}

// ---- Helpers ----

function rowToCsv(r: AuditLogRow): string {
  const csvHeaders = ['id', 'created_at', 'action', 'resource_type', 'resource_id', 'user_id', 'ip_address'];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  return csvHeaders.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(',');
}


