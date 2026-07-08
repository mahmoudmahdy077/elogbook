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
 * Exports audit logs as CSV or PDF with optional date range filter.
 * Respects tenant isolation — only returns logs for the caller's tenant.
 *
 * Query params:
 *   - startDate: ISO date string (inclusive lower bound)
 *   - endDate: ISO date string (inclusive upper bound)
 *   - format: 'csv' | 'pdf' (default: 'csv')
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
  const format = url.searchParams.get('format') || 'csv';

  if (format !== 'csv' && format !== 'pdf') {
    return NextResponse.json(
      { error: 'format must be "csv" or "pdf"' },
      { status: 400 },
    );
  }

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
      format,
      date_range: { start: startDate ?? null, end: endDate ?? null },
    },
  }).maybeSingle();

  // ---- Format response ----
  if (format === 'csv') {
    const csv = toCsv(rows);
    const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  // ---- PDF export ----
  if (format === 'pdf') {
    // Build PDF using the existing edge function via fetch
    const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-pdf`;

    const pdfPayload = {
      case_ids: rows.map((r) => r.resource_id).filter(Boolean),
      resident_name: 'Audit Log Export',
      tenant: tenant.slug,
    };

    let pdfResponse;
    try {
      pdfResponse = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        },
        body: JSON.stringify(pdfPayload),
      });
    } catch (_err) {
      // Edge function unavailable — fall back to inline HTML
      return generateAuditPdfInline(rows, {
        tenantName: tenant.slug,
        startDate,
        endDate,
      });
    }

    if (!pdfResponse.ok) {
      // Fallback: render audit log data as a simple inline PDF table
      return generateAuditPdfInline(rows, {
        tenantName: tenant.slug,
        startDate,
        endDate,
      });
    }

    const pdfBytes = await pdfResponse.arrayBuffer();
    const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
}

// ---- Helpers ----

function toCsv(rows: AuditLogRow[]): string {
  const headers = ['id', 'created_at', 'action', 'resource_type', 'resource_id', 'user_id', 'ip_address'];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(','));
  }
  return lines.join('\n');
}

async function generateAuditPdfInline(
  rows: AuditLogRow[],
  meta: { tenantName: string; startDate: string | null; endDate: string | null },
): Promise<Response> {
  // Build a simple HTML table and convert to PDF using a lightweight approach.
  // Since we can't use pdf-lib on the server (it's a Deno edge function dep),
  // we generate an HTML document that the browser can print to PDF.
  const title = `Audit Log Export - ${meta.tenantName}`;
  const dateRange = meta.startDate || meta.endDate
    ? `${meta.startDate ?? '…'} to ${meta.endDate ?? '…'}`
    : 'All dates';

  const tableRows = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.created_at)}</td>
      <td>${escapeHtml(r.action)}</td>
      <td>${escapeHtml(r.resource_type)}</td>
      <td>${escapeHtml(truncateId(r.resource_id))}</td>
      <td>${escapeHtml(truncateId(r.user_id))}</td>
      <td>${escapeHtml(r.ip_address ?? '')}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
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
  <div class="meta">${escapeHtml(dateRange)} · ${rows.length} entries</div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Action</th>
        <th>Resource</th>
        <th>Res ID</th>
        <th>User</th>
        <th>IP</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <div class="footer">Generated by E-Logbook on ${new Date().toISOString().slice(0, 10)}</div>
</body>
</html>`;

  const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.html`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-Format': 'html',
      'X-Export-Note': 'PDF generation unavailable; downloaded as HTML for browser print-to-PDF',
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncateId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `…${id.slice(-8)}` : id;
}
