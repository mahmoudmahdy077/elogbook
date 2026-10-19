import { requirePrincipal, corsHeaders, escapeHtml } from '../_shared/auth.ts';
import { writeAuditEvent } from '../_shared/audit.ts';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import {
  PDF_SCOPE_ROLES,
  authorizePdfScope,
  buildPdfReportRows,
  type PdfRequestBody,
  type PdfRow,
} from './export-policy.ts';

/**
 * Case report PDF — the documented single-resident supervisor scope.
 *
 * See ./export-policy.ts. The endpoint only produces a report for one
 * resident of the caller's own tenant, requested by a supervisor/director/
 * institution_admin/admin at AAL2, over that resident's approved, non-deleted
 * cases. The resident label is resolved server-side (a caller-supplied
 * `resident_name` is rejected), the query no longer selects `field_values`, and
 * a failed audit write withholds the document.
 */
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await requirePrincipal(req, {
    roles: PDF_SCOPE_ROLES,
    aal: 'aal2',
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, principal } = authResult;

  const json = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  let payload: PdfRequestBody;
  try {
    payload = await req.json();
  } catch {
    return json(400, 'Invalid JSON body');
  }
  if (!payload || typeof payload !== 'object') return json(400, 'Invalid JSON body');

  const scope = authorizePdfScope({
    principal: {
      role: principal.role,
      profileId: principal.profileId,
      tenantId: principal.tenantId,
      aal: principal.aal,
      profileStatus: principal.profileStatus,
      tenantStatus: principal.tenantStatus,
    },
    body: payload,
  });
  if (!scope.ok) return json(scope.status, scope.error);

  // Per-user rate limit (P2.10): max 10 PDFs per minute.
  const { data: userRow } = await supabase.auth.getUser();
  const userId = userRow?.user?.id;
  if (userId) {
    const { data: rl } = await supabase.rpc('check_rate_limit', {
      p_key: `pdf:${userId}`,
      p_max: 10,
      p_window_seconds: 60,
    }) as { data?: { allowed?: boolean; retry_after?: number } | null; error?: unknown };
    if (rl && rl.allowed === false) {
      return json(429, 'Too many PDF requests');
    }
  }

  // The resident label is server-resolved from the tenant-scoped profile, never
  // asserted by the caller.
  const { data: residentRow, error: residentError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', scope.residentId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const resident = (residentRow ?? null) as { full_name?: string | null } | null;
  if (residentError || !resident) {
    return json(404, 'Resident not found in this tenant');
  }

  const { data: cases, error: casesError } = await supabase
    .from('case_entries')
    .select('id, resident_id, tenant_id, status, case_date, deleted_at, case_templates!inner(specialty, name)')
    .in('id', scope.caseIds)
    .eq('tenant_id', tenantId);

  if (casesError) {
    console.error('Failed to fetch cases for PDF');
    return json(500, 'Failed to fetch case data');
  }

  const report = buildPdfReportRows({
    rows: (cases ?? []) as unknown as PdfRow[],
    residentId: scope.residentId,
    tenantId,
  });

  if (!report.ok) {
    return json(
      report.reason === 'resident_scope_violation' ? 403 : 404,
      report.reason === 'resident_scope_violation'
        ? 'Requested cases are outside the authorized resident scope'
        : 'No valid cases found for this tenant',
    );
  }

  const now = new Date().toLocaleString('en-US', { timeZone: 'UTC' });
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  const marginLeft = 50;
  const marginRight = 50;
  const contentWidth = pageWidth - marginLeft - marginRight;
  let y = pageHeight - 40;

  const darkGray = rgb(0.2, 0.2, 0.2);
  const mediumGray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.953, 0.953, 0.953);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);

  function drawTableBorder(x: number, yPos: number, w: number, h: number) {
    page.drawRectangle({ x, y: yPos - h, width: w, height: h, borderColor: mediumGray, borderWidth: 0.5, color: white });
  }

  function drawCellBg(x: number, yPos: number, w: number, h: number, color: typeof white) {
    page.drawRectangle({ x, y: yPos - h, width: w, height: h, color });
  }

  function addPageIfNeeded(needed: number) {
    if (y - needed < 60) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - 40;
    }
  }

  page.drawText('E-Logbook Case Report', { x: marginLeft, y, size: 22, font: fontBold, color: darkGray });
  y -= 28;

  page.drawText(`Resident: ${escapeHtml(resident.full_name ?? '')}`, { x: marginLeft, y, size: 11, font, color: darkGray });
  y -= 16;
  page.drawText(`Report scope: single resident (${scope.residentId})`, { x: marginLeft, y, size: 11, font, color: darkGray });
  y -= 16;
  page.drawText(`Generated: ${now}`, { x: marginLeft, y, size: 11, font, color: mediumGray });
  y -= 14;

  page.drawLine({ start: { x: marginLeft, y }, end: { x: pageWidth - marginRight, y }, thickness: 0.5, color: mediumGray });
  y -= 18;

  const rowH = 20;
  const dateColW = 100;

  drawCellBg(marginLeft, y, contentWidth, rowH, lightGray);
  page.drawLine({ start: { x: marginLeft, y }, end: { x: pageWidth - marginRight, y }, thickness: 0.5, color: mediumGray });
  page.drawText('Date', { x: marginLeft + 8, y: y - 13, size: 10, font: fontBold, color: darkGray });
  page.drawText('Template', { x: marginLeft + dateColW + 8, y: y - 13, size: 10, font: fontBold, color: darkGray });
  page.drawLine({ start: { x: marginLeft + dateColW, y }, end: { x: marginLeft + dateColW, y: y - rowH }, thickness: 0.5, color: mediumGray });
  y -= rowH;

  for (const row of report.rows) {
    addPageIfNeeded(rowH + 2);
    const text = `${row.specialty || 'N/A'} - ${row.templateName || 'N/A'}`;

    drawTableBorder(marginLeft, y, contentWidth, rowH);
    page.drawText(row.caseDate, { x: marginLeft + 8, y: y - 13, size: 10, font, color: black });
    page.drawText(text, { x: marginLeft + dateColW + 8, y: y - 13, size: 10, font, color: black });
    page.drawLine({ start: { x: marginLeft + dateColW, y }, end: { x: marginLeft + dateColW, y: y - rowH }, thickness: 0.5, color: mediumGray });
    y -= rowH;
  }

  y -= 10;
  addPageIfNeeded(40);
  page.drawLine({ start: { x: marginLeft, y }, end: { x: pageWidth - marginRight, y }, thickness: 0.5, color: mediumGray });
  y -= 14;
  page.drawText('This report was self-attested by the resident. Verify all entries before submission.', { x: marginLeft, y, size: 9, font, color: mediumGray });
  y -= 12;
  page.drawText(`Generated by E-Logbook on ${now}`, { x: marginLeft, y, size: 9, font, color: mediumGray });

  const pdfBytes = await pdfDoc.save();

  // Required audit event: a chart disclosure without a record is a compliance
  // failure, so a failed write withholds the document.
  try {
    await writeAuditEvent(supabase, {
      action: 'pdf_export',
      resourceType: 'profiles',
      resourceId: scope.residentId,
      tenantId,
      changes: {
        case_count: report.rows.length,
        requested_count: scope.caseIds.length,
        format: 'pdf',
        scope: 'single_resident',
      },
    });
  } catch {
    return json(500, 'Audit write failed; report withheld');
  }

  return new Response(pdfBytes as unknown as BodyInit, {
    headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="case-report.pdf"',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
});
