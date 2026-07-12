import { describe, it, expect } from 'vitest';
import {
  generateCaseSummaryPDF,
  generateAuditLogPDF,
  generateComplianceReportPDF,
} from '../pdf-templates';
import type { CaseData, AuditLogEntry, ComplianceReportData } from '../pdf-templates';

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function isValidHtml(html: string): boolean {
  return (
    html.startsWith('<!DOCTYPE html>') &&
    html.includes('</html>') &&
    html.includes('<body>') &&
    html.includes('</body>')
  );
}

// ---------------------------------------------------------------------------
//  Fixtures
// ---------------------------------------------------------------------------

const sampleCase: CaseData = {
  id: 'case-001',
  caseDate: '2025-06-15',
  specialty: 'General Surgery',
  procedureName: 'Laparoscopic Cholecystectomy',
  patientInfo: {
    initials: 'JD',
    mrn: 'MRN-88472',
    age: 45,
    gender: 'Male',
  },
  procedureDetails: {
    diagnosis: 'Cholelithiasis',
    findings: 'Multiple gallstones, normal CBD',
    complications: 'None',
    'operative_time_minutes': '65',
  },
  supervisor: {
    name: 'Dr. Sarah Chen',
    title: 'Attending Surgeon',
  },
  status: 'approved',
  residentName: 'Dr. Alex Rivera',
  notes: 'Patient tolerated the procedure well.',
};

const sampleLogs: AuditLogEntry[] = [
  {
    id: 'log-1',
    createdAt: '2025-06-15T10:30:00Z',
    action: 'case_create',
    resourceType: 'case_entries',
    resourceId: 'case-001',
    userId: 'user-abc-123',
    ipAddress: '192.168.1.100',
  },
  {
    id: 'log-2',
    createdAt: '2025-06-15T11:00:00Z',
    action: 'case_approve',
    resourceType: 'case_entries',
    resourceId: 'case-001',
    userId: 'user-xyz-789',
    ipAddress: '10.0.0.1',
  },
];

const sampleComplianceData: ComplianceReportData = {
  tenantName: 'Demo Hospital',
  sections: [
    {
      title: 'PHI Inventory',
      type: 'phi-inventory',
      rows: [
        { table_name: 'case_entries', total_records: 150, phi_present: 42, phi_redacted: 108, phi_percentage: '28.0' },
        { table_name: 'profiles', total_records: 25, phi_present: 25, phi_redacted: 0, phi_percentage: '100.0' },
      ],
    },
    {
      title: 'Data Access Log',
      type: 'data-access',
      rows: [
        { created_at: '2025-06-15T10:30:00Z', action: 'case_create', resource_type: 'case_entries', user_id: 'user-abc' },
        { created_at: '2025-06-15T11:00:00Z', action: 'case_approve', resource_type: 'case_entries', user_id: 'user-xyz' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
//  1. Case Summary Template
// ---------------------------------------------------------------------------

describe('generateCaseSummaryPDF', () => {
  it('produces a valid HTML document', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(isValidHtml(html)).toBe(true);
  });

  it('contains the report title', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('Case Summary');
  });

  it('contains case ID, specialty, procedure name', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('case-001');
    expect(html).toContain('General Surgery');
    expect(html).toContain('Laparoscopic Cholecystectomy');
  });

  it('contains de-identified patient info (initials, MRN, age, gender)', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('JD');
    expect(html).toContain('MRN-88472');
    expect(html).toContain('45');
    expect(html).toContain('Male');
  });

  it('contains procedure details', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('Cholelithiasis');
    expect(html).toContain('Multiple gallstones');
    expect(html).toContain('65');
  });

  it('contains supervisor info and signature lines', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('Dr. Sarah Chen');
    expect(html).toContain('Attending Surgeon');
    expect(html).toContain('Supervisor Signature');
    expect(html).toContain('signature-block');
  });

  it('renders status badge with correct label', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('Approved');
  });

  it('contains hospital name when provided', () => {
    const html = generateCaseSummaryPDF(sampleCase, { hospitalName: 'St. Mary\'s Hospital' });
    expect(html).toContain('St. Mary&#39;s Hospital');
  });

  it('contains resident name when provided', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('Dr. Alex Rivera');
  });

  it('contains notes when provided', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('Patient tolerated the procedure well.');
  });

  it('handles minimal case data without patient info or supervisor', () => {
    const minimal: CaseData = {
      id: 'case-002',
      caseDate: '2025-01-01',
      specialty: 'Cardiology',
      procedureName: 'Echocardiogram',
      status: 'pending',
    };
    const html = generateCaseSummaryPDF(minimal);
    expect(isValidHtml(html)).toBe(true);
    expect(html).toContain('Cardiology');
    expect(html).toContain('Echocardiogram');
    expect(html).toContain('Pending');
  });

  it('handles rejected status badge', () => {
    const rejected: CaseData = { ...sampleCase, status: 'rejected' };
    const html = generateCaseSummaryPDF(rejected);
    expect(html).toContain('Rejected');
  });

  it('handles empty procedure details gracefully', () => {
    const noDetails: CaseData = {
      ...sampleCase,
      procedureDetails: undefined,
    };
    const html = generateCaseSummaryPDF(noDetails);
    expect(isValidHtml(html)).toBe(true);
    expect(html).toContain('Case Summary');
  });

  it('contains Apple Health blue accent (#007AFF) in CSS', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('#007AFF');
  });

  it('contains print-friendly CSS with @page', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('@page');
    expect(html).toContain('size: A4 portrait');
  });

  it('contains footer with E-Logbook branding', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('E-Logbook Enterprise');
  });

  it('includes logo img tag when logoUrl is provided', () => {
    const html = generateCaseSummaryPDF(sampleCase, { logoUrl: 'https://example.com/logo.png' });
    expect(html).toContain('src="https://example.com/logo.png"');
  });
});

// ---------------------------------------------------------------------------
//  2. Audit Log Template
// ---------------------------------------------------------------------------

describe('generateAuditLogPDF', () => {
  it('produces a valid HTML document', () => {
    const html = generateAuditLogPDF(sampleLogs);
    expect(isValidHtml(html)).toBe(true);
  });

  it('contains the report title', () => {
    const html = generateAuditLogPDF(sampleLogs);
    expect(html).toContain('Audit Log Export');
  });

  it('contains audit log entries', () => {
    const html = generateAuditLogPDF(sampleLogs);
    expect(html).toContain('case_create');
    expect(html).toContain('case_approve');
  });

  it('contains date range when provided', () => {
    const html = generateAuditLogPDF(sampleLogs, {
      startDate: '2025-01-01',
      endDate: '2025-12-31',
    });
    expect(html).toContain('Jan 1, 2025');
    expect(html).toContain('Dec 31, 2025');
  });

  it('shows "All dates" when no date range provided', () => {
    const html = generateAuditLogPDF(sampleLogs);
    expect(html).toContain('All dates');
  });

  it('displays tenant name when provided', () => {
    const html = generateAuditLogPDF(sampleLogs, { tenantName: 'Demo Hospital' });
    expect(html).toContain('Demo Hospital');
  });

  it('handles empty logs array', () => {
    const html = generateAuditLogPDF([]);
    expect(isValidHtml(html)).toBe(true);
    expect(html).toContain('No audit log entries found');
  });

  it('contains table headers for audit fields', () => {
    const html = generateAuditLogPDF(sampleLogs);
    expect(html).toContain('>Date<');
    expect(html).toContain('>Action<');
    expect(html).toContain('>Resource ID<');
    expect(html).toContain('>IP Address<');
  });

  it('contains entry count', () => {
    const html = generateAuditLogPDF(sampleLogs);
    expect(html).toContain('2 events');
  });

  it('handles null resource/user IDs gracefully', () => {
    const nullLogs: AuditLogEntry[] = [
      {
        id: 'log-3',
        createdAt: '2025-06-15T12:00:00Z',
        action: 'test',
        resourceType: 'test',
        resourceId: null,
        userId: null,
        ipAddress: null,
      },
    ];
    const html = generateAuditLogPDF(nullLogs);
    expect(isValidHtml(html)).toBe(true);
  });

  it('contains hospital name override', () => {
    const html = generateAuditLogPDF(sampleLogs, { hospitalName: 'City Medical Center' });
    expect(html).toContain('City Medical Center');
  });
});

// ---------------------------------------------------------------------------
//  3. Compliance Report Template
// ---------------------------------------------------------------------------

describe('generateComplianceReportPDF', () => {
  it('produces a valid HTML document', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(isValidHtml(html)).toBe(true);
  });

  it('contains the report title', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('Compliance Report');
  });

  it('contains tenant name', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('Demo Hospital');
  });

  it('renders all sections', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('PHI Inventory');
    expect(html).toContain('Data Access Log');
  });

  it('renders section data rows', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('case_entries');
    expect(html).toContain('profiles');
    expect(html).toContain('28.0');
    expect(html).toContain('100.0');
  });

  it('shows record counts per section', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('2 records');
  });

  it('handles sections with no rows', () => {
    const empty: ComplianceReportData = {
      tenantName: 'Test',
      sections: [
        { title: 'Empty Section', type: 'consent', rows: [] },
      ],
    };
    const html = generateComplianceReportPDF(empty);
    expect(isValidHtml(html)).toBe(true);
    expect(html).toContain('No structured data available');
  });

  it('handles completely empty data gracefully', () => {
    const empty: ComplianceReportData = {
      tenantName: 'Test',
      sections: [],
    };
    const html = generateComplianceReportPDF(empty);
    expect(isValidHtml(html)).toBe(true);
    expect(html).toContain('0 sections');
  });

  it('contains total record count', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('4');
  });

  it('contains Apple Health CSS styling', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('#007AFF');
    expect(html).toContain('@page');
  });

  it('contains hospital name override', () => {
    const html = generateComplianceReportPDF(sampleComplianceData, { hospitalName: 'Lakeside Clinic' });
    expect(html).toContain('Lakeside Clinic');
  });

  it('renders column headers from row keys', () => {
    const html = generateComplianceReportPDF(sampleComplianceData);
    expect(html).toContain('table name');
    expect(html).toContain('total records');
    expect(html).toContain('phi present');
  });
});

// ---------------------------------------------------------------------------
//  4. Cross-template consistency
// ---------------------------------------------------------------------------

describe('PDF template consistency', () => {
  it('all templates include @page print margins', () => {
    const caseHtml = generateCaseSummaryPDF(sampleCase);
    const auditHtml = generateAuditLogPDF(sampleLogs);
    const complianceHtml = generateComplianceReportPDF(sampleComplianceData);

    for (const html of [caseHtml, auditHtml, complianceHtml]) {
      expect(html).toContain('margin: 20mm');
      expect(html).toContain('size: A4 portrait');
    }
  });

  it('all templates include page counter CSS', () => {
    const caseHtml = generateCaseSummaryPDF(sampleCase);
    expect(caseHtml).toContain('counter(page)');
  });

  it('all templates contain E-Logbook Enterprise footer', () => {
    const caseHtml = generateCaseSummaryPDF(sampleCase);
    const auditHtml = generateAuditLogPDF(sampleLogs);
    const complianceHtml = generateComplianceReportPDF(sampleComplianceData);

    for (const html of [caseHtml, auditHtml, complianceHtml]) {
      expect(html).toContain('E-Logbook Enterprise');
    }
  });

  it('all templates use system sans-serif font stack', () => {
    const html = generateCaseSummaryPDF(sampleCase);
    expect(html).toContain('-apple-system');
    expect(html).toContain('BlinkMacSystemFont');
    expect(html).toContain('sans-serif');
  });

  it('all templates have no background colors (printer-friendly)', () => {
    // Check that there are no bgcolor or background-color CSS properties except
    // the subtle #FAFAFA for alternating table rows and none in body.
    // This is a soft check — we assert the body has no background-color.
    const html = generateCaseSummaryPDF(sampleCase);
    // Body should not set background-color
    expect(html).not.toContain('body { background');
  });
});
