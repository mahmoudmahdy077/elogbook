import { authenticate, corsHeaders, escapeHtml } from '../_shared/auth.ts';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

interface CaseData {
  case_date: string;
  patient_mrn?: string;
  specialty: string;
  name: string;
}

interface GeneratePdfPayload {
  case_ids: string[];
  resident_name: string;
  tenant: string;
}

const MAX_CASE_IDS = 100;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId } = authResult;

  let payload: GeneratePdfPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { case_ids, resident_name, tenant } = payload;

  if (!case_ids || !Array.isArray(case_ids) || case_ids.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No cases specified' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (case_ids.length > MAX_CASE_IDS) {
    return new Response(
      JSON.stringify({ error: `Too many cases (max ${MAX_CASE_IDS})` }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!resident_name || !tenant) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: resident_name, tenant' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: cases, error: casesError } = await supabase
    .from('case_entries')
    .select(`
      case_date,
      field_values,
      template_id,
      case_templates!inner(specialty, name, fields)
    `)
    .in('id', case_ids)
    .eq('tenant_id', tenantId)
    .eq('status', 'approved');

  if (casesError) {
    console.error('Failed to fetch cases for PDF', { error: casesError.message });
    return new Response(
      JSON.stringify({ error: 'Failed to fetch case data' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!cases || cases.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No valid cases found for this tenant' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
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

  page.drawText(`Resident: ${escapeHtml(resident_name)}`, { x: marginLeft, y, size: 11, font, color: darkGray });
  y -= 16;
  page.drawText(`Tenant: ${escapeHtml(tenant)}`, { x: marginLeft, y, size: 11, font, color: darkGray });
  y -= 16;
  page.drawText(`Generated: ${now}`, { x: marginLeft, y, size: 11, font, color: mediumGray });
  y -= 14;

  page.drawLine({ start: { x: marginLeft, y }, end: { x: pageWidth - marginRight, y }, thickness: 0.5, color: mediumGray });
  y -= 18;

  const rowH = 20;
  const dateColW = 100;
  const templateColW = contentWidth - dateColW;

  drawCellBg(marginLeft, y, contentWidth, rowH, lightGray);
  page.drawLine({ start: { x: marginLeft, y }, end: { x: pageWidth - marginRight, y }, thickness: 0.5, color: mediumGray });
  page.drawText('Date', { x: marginLeft + 8, y: y - 13, size: 10, font: fontBold, color: darkGray });
  page.drawText('Template', { x: marginLeft + dateColW + 8, y: y - 13, size: 10, font: fontBold, color: darkGray });
  page.drawLine({ start: { x: marginLeft + dateColW, y }, end: { x: marginLeft + dateColW, y: y - rowH }, thickness: 0.5, color: mediumGray });
  y -= rowH;

  for (const c of cases as any[]) {
    addPageIfNeeded(rowH + 2);
    const template = c.case_templates as any;
    const date = c.case_date ?? '';
    const text = `${template?.specialty ?? 'N/A'} - ${template?.name ?? 'N/A'}`;

    drawTableBorder(marginLeft, y, contentWidth, rowH);
    page.drawText(date, { x: marginLeft + 8, y: y - 13, size: 10, font, color: black });
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
  return new Response(pdfBytes, {
    headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="case-report.pdf"' },
  });
});