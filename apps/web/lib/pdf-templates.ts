/**
 * Professional PDF Templates — Apple Health–inspired, hospital-branded exports.
 *
 * Each function returns a complete HTML document string ready for HTML-to-PDF
 * conversion (puppeteer, playwright, wkhtmltopdf, or browser print-to-PDF).
 *
 * Design system:
 *   - Typography: system sans-serif (Inter, SF Pro, Arial fallback), weight 300/400
 *   - Accent: #007AFF (Apple blue) for headers, rules, and key indicators
 *   - Status badges: pending/amber (#FF9500), approved/green (#34C759), rejected/red (#FF3B30)
 *   - Generous whitespace, print-friendly (no background colours) with @page margins
 *   - Page count / generation timestamp in footer
 *   - Hospital name placeholder in header
 */

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface PdfOptions {
  /** Hospital / institution name displayed in the report header */
  hospitalName?: string;
  /** URL or data-URI for the hospital logo (rendered in header) */
  logoUrl?: string;
  /** Override the generation timestamp (defaults to now) */
  generatedAt?: Date;
}

export interface CasePatientInfo {
  mrn?: string;
  age?: number;
  gender?: string;
  initials?: string;
}

export interface CaseSupervisor {
  name: string;
  title: string;
  signature?: string;
}

export interface CaseData {
  id: string;
  caseDate: string;
  specialty: string;
  procedureName: string;
  patientInfo?: CasePatientInfo;
  procedureDetails?: Record<string, string>;
  supervisor?: CaseSupervisor;
  status: 'pending' | 'approved' | 'rejected';
  residentName?: string;
  /** Additional notes */
  notes?: string;
}

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: string | null;
  ipAddress: string | null;
  changes?: Record<string, unknown> | null;
}

export interface AuditLogOptions extends PdfOptions {
  startDate?: string;
  endDate?: string;
  tenantName?: string;
}

export interface ComplianceReportRow {
  [key: string]: unknown;
}

export interface ComplianceSection {
  title: string;
  type: 'phi-inventory' | 'data-access' | 'consent' | 'retention';
  rows: ComplianceReportRow[];
}

export interface ComplianceReportData {
  tenantName: string;
  sections: ComplianceSection[];
}

// ---------------------------------------------------------------------------
//  Shared helpers
// ---------------------------------------------------------------------------

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function badgeHtml(status: string): string {
  const colors: Record<string, string> = {
    pending: '#FF9500',
    approved: '#34C759',
    rejected: '#FF3B30',
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const color = colors[status.toLowerCase()] ?? '#6D6D73';
  return `<span class="badge" style="color:${color};border:1px solid ${color};">${escapeHtml(label)}</span>`;
}

/** Shared print-friendly CSS across all templates. */
const BASE_STYLES = `
  @page {
    margin: 20mm 18mm 25mm 18mm;
    size: A4 portrait;
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      font-size: 8pt;
      color: #6D6D73;
    }
  }

  * { box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    font-weight: 400;
    font-size: 10pt;
    line-height: 1.5;
    color: #1C1C1E;
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- Header ---- */
  .report-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12pt;
    border-bottom: 2px solid #007AFF;
    margin-bottom: 20pt;
  }
  .report-header .brand {
    display: flex;
    align-items: center;
    gap: 10pt;
  }
  .report-header .brand img {
    max-height: 32pt;
    max-width: 120pt;
  }
  .report-header .brand .hospital-name {
    font-size: 14pt;
    font-weight: 400;
    color: #007AFF;
    letter-spacing: -0.02em;
  }
  .report-header .report-meta {
    text-align: right;
    font-size: 8pt;
    color: #8E8E93;
    line-height: 1.6;
  }

  /* ---- Titles ---- */
  h1 {
    font-size: 20pt;
    font-weight: 300;
    color: #1C1C1E;
    margin: 0 0 4pt 0;
    letter-spacing: -0.03em;
  }
  h2 {
    font-size: 13pt;
    font-weight: 400;
    color: #007AFF;
    margin: 20pt 0 8pt 0;
    letter-spacing: -0.01em;
    padding-bottom: 4pt;
    border-bottom: 1px solid #E5E5EA;
  }
  h3 {
    font-size: 11pt;
    font-weight: 500;
    color: #3A3A3C;
    margin: 14pt 0 6pt 0;
  }

  /* ---- Text ---- */
  .subtitle {
    font-size: 10pt;
    color: #8E8E93;
    margin-bottom: 16pt;
  }

  /* ---- Detail list (key-value pairs) ---- */
  .detail-grid {
    display: grid;
    grid-template-columns: 160pt 1fr;
    gap: 4pt 12pt;
    margin-bottom: 12pt;
  }
  .detail-grid .label {
    font-size: 9pt;
    font-weight: 500;
    color: #8E8E93;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .detail-grid .value {
    font-size: 10pt;
    color: #1C1C1E;
  }

  /* ---- Tables ---- */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12pt;
    page-break-inside: avoid;
  }
  thead th {
    text-align: left;
    padding: 8pt 6pt;
    border-bottom: 2px solid #007AFF;
    font-weight: 500;
    font-size: 8pt;
    color: #007AFF;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  tbody td {
    padding: 7pt 6pt;
    border-bottom: 1px solid #E5E5EA;
    vertical-align: top;
    font-size: 9pt;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  tbody tr:nth-child(even) {
    background-color: #FAFAFA;
  }

  .table-count {
    font-size: 9pt;
    color: #8E8E93;
    margin-top: -8pt;
    margin-bottom: 10pt;
  }

  /* ---- Signature block ---- */
  .signature-block {
    margin-top: 24pt;
    padding-top: 12pt;
    border-top: 1px solid #E5E5EA;
    page-break-inside: avoid;
  }
  .signature-block .sig-line {
    display: flex;
    justify-content: space-between;
    margin-top: 28pt;
    font-size: 9pt;
    color: #3A3A3C;
  }
  .signature-block .sig-line .line {
    display: inline-block;
    width: 200pt;
    border-bottom: 1px solid #1C1C1E;
    margin-left: 8pt;
  }

  /* ---- Badges (inline) ---- */
  .badge {
    display: inline-block;
    padding: 1pt 7pt;
    border-radius: 10pt;
    font-size: 8pt;
    font-weight: 500;
    letter-spacing: 0.3px;
    background: transparent;
  }

  /* ---- Footer ---- */
  .report-footer {
    margin-top: 28pt;
    padding-top: 8pt;
    border-top: 1px solid #E5E5EA;
    font-size: 8pt;
    color: #8E8E93;
    text-align: center;
  }

  /* ---- Print utilities ---- */
  .page-break { page-break-before: always; }
  .no-break { page-break-inside: avoid; }
  .text-muted { color: #6D6D73; }
  .mt-8 { margin-top: 8pt; }
  .mt-16 { margin-top: 16pt; }
`;

// ---------------------------------------------------------------------------
//  Template: shared header / footer wrappers
// ---------------------------------------------------------------------------

interface HeadFootInput {
  title: string;
  subtitle?: string;
  hospitalName: string;
  logoUrl?: string;
}

function documentWrapper(styles: string, headFoot: HeadFootInput, body: string): string {
  const genDate = new Date();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(headFoot.title)}</title>
  <style>${styles}</style>
</head>
<body>

<div class="report-header">
  <div class="brand">
    ${headFoot.logoUrl ? `<img src="${escapeHtml(headFoot.logoUrl)}" alt="Logo" />` : ''}
    <span class="hospital-name">${escapeHtml(headFoot.hospitalName)}</span>
  </div>
  <div class="report-meta">
    <div>${escapeHtml(headFoot.title)}</div>
    <div>Generated ${formatTimestamp(genDate)}</div>
  </div>
</div>

<h1>${escapeHtml(headFoot.title)}</h1>
${headFoot.subtitle ? `<p class="subtitle">${escapeHtml(headFoot.subtitle)}</p>` : ''}

${body}

<div class="report-footer">
  E-Logbook Enterprise &mdash; ${escapeHtml(headFoot.hospitalName)} &mdash; Generated ${formatTimestamp(genDate)}
</div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
//  1. Case Summary Template
// ---------------------------------------------------------------------------

export interface CaseSummaryOptions extends PdfOptions {
  /** Format the case date for display */
  dateFormatter?: (date: string) => string;
}

/**
 * Generate a "Case Summary" HTML document with full case detail,
 * patient de-identified info, procedure details, supervisor signature,
 * and hospital branding.
 */
export function generateCaseSummaryPDF(
  caseData: CaseData,
  options: CaseSummaryOptions = {},
): string {
  const hospital = options.hospitalName ?? 'E-Logbook Enterprise';
  const detailRows = caseData.procedureDetails
    ? Object.entries(caseData.procedureDetails)
        .map(
          ([key, val]) =>
            `<div class="label">${escapeHtml(key.replace(/_/g, ' '))}</div>
             <div class="value">${escapeHtml(val)}</div>`,
        )
        .join('\n      ')
    : '';

  const patientFields: { label: string; value: string }[] = [];
  if (caseData.patientInfo?.initials) patientFields.push({ label: 'Patient', value: caseData.patientInfo.initials });
  if (caseData.patientInfo?.mrn) patientFields.push({ label: 'MRN', value: caseData.patientInfo.mrn });
  if (caseData.patientInfo?.age !== undefined) patientFields.push({ label: 'Age', value: String(caseData.patientInfo.age) });
  if (caseData.patientInfo?.gender) patientFields.push({ label: 'Gender', value: caseData.patientInfo.gender });

  const patientGrid = patientFields.length
    ? `<h2>Patient Information (De-identified)</h2>
       <div class="detail-grid no-break">
         ${patientFields.map((f) => `${'      '}<div class="label">${escapeHtml(f.label)}</div><div class="value">${escapeHtml(f.value)}</div>`).join('\n')}
       </div>`
    : '';

  const supervisorBlock = caseData.supervisor
    ? `<div class="signature-block">
         <h2>Supervisor Verification</h2>
         <div class="detail-grid">
           <div class="label">Supervisor</div>
           <div class="value">${escapeHtml(caseData.supervisor.name)}</div>
           <div class="label">Title</div>
           <div class="value">${escapeHtml(caseData.supervisor.title)}</div>
         </div>
         <div class="sig-line">
           <span>Supervisor Signature<span class="line"></span></span>
           <span>Date<span class="line"></span></span>
         </div>
       </div>`
    : '';

  const body = `
  <div class="detail-grid no-break">
    <div class="label">Case ID</div>
    <div class="value">${escapeHtml(caseData.id)}</div>
    <div class="label">Date</div>
    <div class="value">${formatDate(caseData.caseDate)}</div>
    <div class="label">Specialty</div>
    <div class="value">${escapeHtml(caseData.specialty)}</div>
    <div class="label">Procedure</div>
    <div class="value">${escapeHtml(caseData.procedureName)}</div>
    <div class="label">Status</div>
    <div class="value">${badgeHtml(caseData.status)}</div>
    ${caseData.residentName ? `<div class="label">Resident</div><div class="value">${escapeHtml(caseData.residentName)}</div>` : ''}
  </div>

  ${patientGrid}

  ${detailRows ? `<h2>Procedure Details</h2>
  <div class="detail-grid no-break">
    ${detailRows}
  </div>` : ''}

  ${caseData.notes ? `<h2>Notes</h2>
  <p class="no-break">${escapeHtml(caseData.notes)}</p>` : ''}

  ${supervisorBlock}
  `;

  return documentWrapper(
    BASE_STYLES,
    {
      title: 'Case Summary',
      subtitle: `${caseData.specialty} — ${caseData.procedureName}`,
      hospitalName: hospital,
      logoUrl: options.logoUrl,
    },
    body,
  );
}

// ---------------------------------------------------------------------------
//  2. Audit Log Template
// ---------------------------------------------------------------------------

/**
 * Generate an "Audit Log" HTML document with a clean table,
 * date range headers, and page numbers.
 */
export function generateAuditLogPDF(
  logs: AuditLogEntry[],
  options: AuditLogOptions = {},
): string {
  const hospital = options.hospitalName ?? 'E-Logbook Enterprise';
  const tenant = options.tenantName ?? '';

  const dateRange =
    options.startDate || options.endDate
      ? `${options.startDate ? formatDate(options.startDate) : '…'} — ${options.endDate ? formatDate(options.endDate) : '…'}`
      : 'All dates';

  const tableBody =
    logs.length === 0
      ? '<tr><td colspan="6" style="text-align:center;color:#6D6D73;padding:20pt;">No audit log entries found.</td></tr>'
      : logs
          .map(
            (l) => `
    <tr>
      <td>${escapeHtml(formatDate(l.createdAt))}</td>
      <td>${escapeHtml(l.action)}</td>
      <td>${escapeHtml(l.resourceType)}</td>
      <td>${escapeHtml(l.resourceId ? (l.resourceId.length > 12 ? '…' + l.resourceId.slice(-12) : l.resourceId) : '—')}</td>
      <td>${escapeHtml(l.userId ? (l.userId.length > 12 ? '…' + l.userId.slice(-12) : l.userId) : '—')}</td>
      <td style="font-family:monospace;font-size:8pt;">${escapeHtml(l.ipAddress ?? '—')}</td>
    </tr>`,
          )
          .join('');

  const styles = BASE_STYLES + `
    table { font-size: 8.5pt; }
    th:nth-child(1) { width: 14%; }
    th:nth-child(2) { width: 14%; }
    th:nth-child(3) { width: 14%; }
    th:nth-child(4) { width: 16%; }
    th:nth-child(5) { width: 16%; }
    th:nth-child(6) { width: 16%; }
    td { font-size: 8pt; }
  `;

  const body = `
  <div class="detail-grid no-break">
    <div class="label">Tenant</div>
    <div class="value">${escapeHtml(tenant || hospital)}</div>
    <div class="label">Date Range</div>
    <div class="value">${escapeHtml(dateRange)}</div>
    <div class="label">Entries</div>
    <div class="value">${logs.length}</div>
  </div>

  <h2>Audit Trail</h2>
  <p class="table-count">${logs.length} event${logs.length !== 1 ? 's' : ''} recorded</p>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Action</th>
        <th>Resource</th>
        <th>Resource ID</th>
        <th>User ID</th>
        <th>IP Address</th>
      </tr>
    </thead>
    <tbody>
      ${tableBody}
    </tbody>
  </table>
  `;

  return documentWrapper(
    styles,
    {
      title: 'Audit Log Export',
      subtitle: tenant ? `${tenant} · ${dateRange}` : dateRange,
      hospitalName: hospital,
      logoUrl: options.logoUrl,
    },
    body,
  );
}

// ---------------------------------------------------------------------------
//  3. Compliance Report Template
// ---------------------------------------------------------------------------

/**
 * Generate a "Compliance Report" HTML document with PHI inventory,
 * data access log, and consent summary sections.
 */
export function generateComplianceReportPDF(
  data: ComplianceReportData,
  options: PdfOptions = {},
): string {
  const hospital = options.hospitalName ?? 'E-Logbook Enterprise';

  const sectionTypeMeta: Record<string, { icon: string; description: string }> = {
    'phi-inventory': {
      icon: '●',
      description: 'Inventory of Protected Health Information across tables.',
    },
    'data-access': {
      icon: '◆',
      description: 'Record of who accessed PHI and when.',
    },
    consent: {
      icon: '■',
      description: 'Patient consent records — type, grant dates, version.',
    },
    retention: {
      icon: '▲',
      description: 'Soft-deleted records pending permanent deletion.',
    },
  };

  const sectionHtml = data.sections
    .map((section) => {
      const meta = sectionTypeMeta[section.type] ?? { icon: '○', description: '' };
      const headers = section.rows.length > 0 ? Object.keys(section.rows[0]!) : [];
      const tableRows =
        section.rows.length === 0
          ? '<tr><td colspan="99" style="text-align:center;color:#6D6D73;padding:16pt;">No data for this section.</td></tr>'
          : section.rows
              .map(
                (r) =>
                  `<tr>${headers.map((h) => `<td>${escapeHtml(String(r[h] ?? '—'))}</td>`).join('')}</tr>`,
              )
              .join('\n        ');

      return `
  <div class="no-break">
    <h2>${meta.icon} ${escapeHtml(section.title)}</h2>
    <p class="table-count">${escapeHtml(meta.description)} · ${section.rows.length} record${section.rows.length !== 1 ? 's' : ''}</p>
    ${headers.length ? `
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${escapeHtml(h.replace(/_/g, ' '))}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>` : '<p class="text-muted">No structured data available.</p>'}
  </div>`;
    })
    .join('');

  const body = `
  <div class="detail-grid no-break">
    <div class="label">Tenant</div>
    <div class="value">${escapeHtml(data.tenantName || hospital)}</div>
    <div class="label">Sections</div>
    <div class="value">${data.sections.length}</div>
    <div class="label">Total Records</div>
    <div class="value">${data.sections.reduce((sum, s) => sum + s.rows.length, 0)}</div>
  </div>

  ${sectionHtml}
  `;

  return documentWrapper(
    BASE_STYLES,
    {
      title: 'Compliance Report',
      subtitle: `${data.tenantName} · ${data.sections.length} section${data.sections.length !== 1 ? 's' : ''}`,
      hospitalName: hospital,
      logoUrl: options.logoUrl,
    },
    body,
  );
}
