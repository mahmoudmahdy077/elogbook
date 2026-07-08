import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticate, corsHeaders, escapeHtml } from '../_shared/auth.ts';

interface WebadsExportPayload {
  tenant_id: string;
  resident_ids: string[];
  date_from?: string;
  date_to?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWebadsXml(
  cases: any[],
  tenantId: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): string {
  const now = new Date().toISOString();
  const dateFromAttr = dateFrom ? escapeXml(dateFrom) : '';
  const dateToAttr = dateTo ? escapeXml(dateTo) : '';

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<WebADSExport xmlns="http://www.acgme.org/WebADS" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.acgme.org/WebADS WebADS.xsd">\n`;
  xml += `  <ExportMetadata>\n`;
  xml += `    <GeneratedAt>${escapeXml(now)}</GeneratedAt>\n`;
  xml += `    <TenantId>${escapeXml(tenantId)}</TenantId>\n`;
  xml += `    <DateFrom>${escapeXml(dateFromAttr)}</DateFrom>\n`;
  xml += `    <DateTo>${escapeXml(dateToAttr)}</DateTo>\n`;
  xml += `    <RecordCount>${cases.length}</RecordCount>\n`;
  xml += `    <System>E-Logbook</System>\n`;
  xml += `    <Version>1.0</Version>\n`;
  xml += `  </ExportMetadata>\n`;
  xml += `  <CaseEntries>\n`;

  for (const c of cases) {
    const template = c.case_templates as any;
    const residentProfile = c.profiles as any;

    xml += `    <CaseEntry>\n`;
    xml += `      <EntryId>${escapeXml(c.id)}</EntryId>\n`;
    xml += `      <CaseDate>${escapeXml(c.case_date ?? '')}</CaseDate>\n`;
    xml += `      <Resident>\n`;
    xml += `        <ResidentId>${escapeXml(c.resident_id)}</ResidentId>\n`;
    xml += `        <FullName>${escapeXml(residentProfile?.full_name ?? '')}</FullName>\n`;
    xml += `        <Specialty>${escapeXml(residentProfile?.specialty ?? '')}</Specialty>\n`;
    xml += `      </Resident>\n`;
    xml += `      <Template>\n`;
    xml += `        <TemplateId>${escapeXml(c.template_id)}</TemplateId>\n`;
    xml += `        <TemplateName>${escapeXml(template?.name ?? '')}</TemplateName>\n`;
    xml += `        <Specialty>${escapeXml(template?.specialty ?? '')}</Specialty>\n`;
    xml += `      </Template>\n`;
    xml += `      <Patient>\n`;
    xml += `        <MRN>${escapeXml(c.patient_mrn ?? '')}</MRN>\n`;
    xml += `        <DOB>${escapeXml(c.patient_dob ?? '')}</DOB>\n`;
    xml += `      </Patient>\n`;
    xml += `      <Status>${escapeXml(c.status)}</Status>\n`;

    if (c.field_values && typeof c.field_values === 'object') {
      xml += `      <FieldValues>\n`;
      for (const [key, value] of Object.entries(c.field_values)) {
        xml += `        <Field name="${escapeXml(key)}">${escapeXml(String(value ?? ''))}</Field>\n`;
      }
      xml += `      </FieldValues>\n`;
    }

    xml += `      <CreatedAt>${escapeXml(c.created_at ?? '')}</CreatedAt>\n`;
    xml += `      <UpdatedAt>${escapeXml(c.updated_at ?? '')}</UpdatedAt>\n`;
    xml += `    </CaseEntry>\n`;
  }

  xml += `  </CaseEntries>\n`;
  xml += `</WebADSExport>\n`;

  return xml;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, role } = authResult;

  // Require elevated role for WebADS export
  const elevatedRoles = ['supervisor', 'director', 'institution_admin', 'admin'];
  if (!elevatedRoles.includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions: requires supervisor, director, institution_admin, or admin role' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  let body: WebadsExportPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const { tenant_id, resident_ids, date_from, date_to } = body;

  if (!tenant_id) {
    return new Response(
      JSON.stringify({ error: 'tenant_id is required' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  if (!resident_ids || !Array.isArray(resident_ids) || resident_ids.length === 0) {
    return new Response(
      JSON.stringify({ error: 'resident_ids must be a non-empty array' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  // Security: ensure requested tenant matches caller's tenant
  if (tenant_id !== tenantId) {
    return new Response(
      JSON.stringify({ error: 'tenant_id mismatch' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  // Validate resident_ids count
  if (resident_ids.length > 500) {
    return new Response(
      JSON.stringify({ error: 'Maximum 500 resident_ids per export' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  // Build query
  let query = supabase
    .from('case_entries')
    .select(`
      id,
      tenant_id,
      resident_id,
      template_id,
      patient_mrn,
      patient_dob,
      case_date,
      field_values,
      status,
      created_at,
      updated_at,
      case_templates!inner(id, name, specialty),
      profiles!inner(id, full_name, specialty)
    `)
    .eq('tenant_id', tenantId)
    .in('resident_id', resident_ids);

  // Apply date range filter
  if (date_from) {
    query = query.gte('case_date', date_from);
  }
  if (date_to) {
    query = query.lte('case_date', date_to);
  }

  // Only export approved or pending entries
  query = query.in('status', ['approved', 'pending']);
  query = query.is('deleted_at', null);
  query = query.order('case_date', { ascending: true });
  query = query.limit(10000);

  const { data: cases, error: casesError } = await query;

  if (casesError) {
    console.error('Failed to fetch cases for WebADS export', { error: casesError.message });
    return new Response(
      JSON.stringify({ error: 'Failed to fetch case data' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  if (!cases || cases.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No cases found for the specified criteria' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const xml = buildWebadsXml(cases, tenantId, date_from, date_to);

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id: tenantId,
    user_id: (await supabase.auth.getUser()).data.user?.id,
    action: 'webads_export',
    resource_type: 'case_entries',
    resource_id: resident_ids.join(','),
    changes: {
      resident_count: resident_ids.length,
      case_count: cases.length,
      date_from: date_from ?? null,
      date_to: date_to ?? null,
      format: 'webads_xml',
    },
  });

  return new Response(xml, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="webads-export-${tenantId}.xml"`,
    },
  });
});
