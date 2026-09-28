import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { requirePrincipal, corsHeaders } from '../_shared/auth.ts';
import { writeAuditEvent } from '../_shared/audit.ts';
import {
  WEBADS_EXPORT_ROLES,
  WEBADS_PAYLOAD_POLICY,
  authorizeWebadsExport,
  buildWebadsExportQuerySpec,
  buildWebadsXml,
  projectWebadsEntries,
  type WebadsRequestBody,
  type WebadsVendorPolicy,
} from './export-policy.ts';

/**
 * ACGME WebADS export — default-deny external PHI egress.
 *
 * See ./export-policy.ts for the full rationale. In short: the feed used to
 * carry resident names, MRNs, DOBs, the free-text field_values blob and
 * unapproved cases. It is now gated on a configured vendor with an approved
 * `metadata_only` payload policy, an explicit de-identified confirmation, an
 * AAL2 director/institution_admin/admin of the same tenant, and an
 * approved-only, non-deleted query whose projection contains no identifier
 * column at all. The export is refused entirely (501) when no vendor is
 * configured, which is the default state of this repository.
 */
function vendorPolicy(): WebadsVendorPolicy {
  return {
    vendorEnabled: Deno.env.get('WEBADS_EXPORT_ENABLED') === 'true',
    approvedPolicy: Deno.env.get('WEBADS_PAYLOAD_POLICY') === WEBADS_PAYLOAD_POLICY
      ? WEBADS_PAYLOAD_POLICY
      : null,
  };
}

function jsonResponse(headers: Record<string, string>, status: number, body: unknown): Response {
  return new Response(JSON.stringify({ error: body }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await requirePrincipal(req, {
    roles: WEBADS_EXPORT_ROLES,
    aal: 'aal2',
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, principal } = authResult;

  let body: WebadsRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(headers, 400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') return jsonResponse(headers, 400, 'Invalid JSON body');

  const decision = authorizeWebadsExport({
    principal: {
      role: principal.role,
      profileId: principal.profileId,
      tenantId: principal.tenantId,
      aal: principal.aal,
      profileStatus: principal.profileStatus,
      tenantStatus: principal.tenantStatus,
    },
    policy: vendorPolicy(),
    body,
  });
  if (!decision.ok) return jsonResponse(headers, decision.status, decision.error);

  const residentIds = body.resident_ids as string[];
  const dateFrom = typeof body.date_from === 'string' ? body.date_from : null;
  const dateTo = typeof body.date_to === 'string' ? body.date_to : null;

  const spec = buildWebadsExportQuerySpec({ tenantId, residentIds, dateFrom, dateTo });

  let query = supabase
    .from('case_entries')
    .select(spec.select)
    .eq('tenant_id', spec.tenantId)
    .in('resident_id', spec.residentIds)
    .in('status', spec.status)
    .order('case_date', { ascending: true })
    .limit(spec.limit);

  if (spec.onlyNotDeleted) query = query.is('deleted_at', null);
  if (spec.dateFrom) query = query.gte('case_date', spec.dateFrom);
  if (spec.dateTo) query = query.lte('case_date', spec.dateTo);

  const { data: cases, error: casesError } = await query;

  if (casesError) {
    console.error('Failed to fetch cases for WebADS export');
    return jsonResponse(headers, 500, 'Failed to fetch case data');
  }

  if (!cases || cases.length === 0) {
    return jsonResponse(headers, 404, 'No cases found for the specified criteria');
  }

  const entries = projectWebadsEntries(cases as never[]);
  const xml = buildWebadsXml({
    tenantId,
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    entries,
  });

  // Required audit event. A disclosure without a record is a compliance
  // failure, so a failed write fails the export closed rather than shipping the
  // document unlogged.
  try {
    await writeAuditEvent(supabase, {
      action: 'webads_export',
      resourceType: 'tenant',
      resourceId: null,
      tenantId,
      changes: {
        resident_count: residentIds.length,
        case_count: entries.length,
        date_from: dateFrom,
        date_to: dateTo,
        format: 'webads_xml',
        payload_policy: WEBADS_PAYLOAD_POLICY,
      },
    });
  } catch {
    return jsonResponse(headers, 500, 'Audit write failed; export withheld');
  }

  return new Response(xml, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="webads-export-${tenantId}.xml"`,
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
});
