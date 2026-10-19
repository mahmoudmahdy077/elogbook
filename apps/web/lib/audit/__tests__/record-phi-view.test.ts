import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { recordPhiView } from '../record-phi-view';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as Parameters<typeof recordPhiView>[0];
}

describe('recordPhiView', () => {
  it('records the disclosure through the trusted RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'audit-row-1', error: null });

    const recorded = await recordPhiView(client(rpc), {
      entryId: ENTRY_ID,
      tenantId: TENANT_ID,
      field: 'mrn',
    });

    expect(recorded).toBe(true);
    expect(rpc).toHaveBeenCalledWith('write_audit_event', {
      p_action: 'phi_view',
      p_resource_type: 'case_entries',
      p_resource_id: ENTRY_ID,
      p_changes: { field: 'mrn' },
      p_tenant_id: TENANT_ID,
    });
  });

  it('never writes through the audit_logs table', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'audit-row-1', error: null });
    const from = vi.fn();

    await recordPhiView({ rpc, from } as unknown as Parameters<typeof recordPhiView>[0], {
      entryId: ENTRY_ID,
      tenantId: TENANT_ID,
      field: 'dob',
    });

    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed when the audit write is rejected', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'row-level security' } });

    const recorded = await recordPhiView(client(rpc), {
      entryId: ENTRY_ID,
      tenantId: TENANT_ID,
      field: 'mrn',
    });

    expect(recorded).toBe(false);
  });

  it('fails closed when the request throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      recordPhiView(client(rpc), { entryId: ENTRY_ID, tenantId: TENANT_ID, field: 'mrn' }),
    ).resolves.toBe(false);
  });

  it('fails closed without issuing a request for a malformed identifier', async () => {
    const rpc = vi.fn();

    await expect(
      recordPhiView(client(rpc), { entryId: 'a,b', tenantId: TENANT_ID, field: 'mrn' }),
    ).resolves.toBe(false);
    await expect(
      recordPhiView(client(rpc), { entryId: ENTRY_ID, tenantId: 'tenant-1', field: 'mrn' }),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an unknown field label', async () => {
    const rpc = vi.fn();

    await expect(
      recordPhiView(client(rpc), {
        entryId: ENTRY_ID,
        tenantId: TENANT_ID,
        field: 'the whole chart' as 'mrn',
      }),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * A PHI disclosure is an audit event, so a screen that renders the raw MRN or
 * DOB column without routing the reveal through `recordPhiView` is an unlogged
 * disclosure. The audit-gated component alone does not prevent that: it only
 * works on the surfaces that use it, and the case list, case detail and preview
 * modal each render these columns from their own query.
 *
 * This asserts the property directly, so adding a new screen that selects
 * `patient_mrn` cannot silently reintroduce an unaudited render.
 */
describe('PHI reveal surfaces', () => {
  const webRoot = resolve(process.cwd());
  const auditedRenderers = new Set([
    join('components', 'PhiFieldCell.tsx'),
    join('components', 'PhiFields.tsx'),
    join('lib', 'audit', 'record-phi-view.ts'),
  ]);

  /**
   * Write-only forms. These initialise the MRN/DOB field to an empty string and
   * only ever render the value the user is typing in this session, so they
   * disclose no stored PHI. They are listed explicitly, with a reason, rather
   * than being silently allowed: a new screen is not exempt by default.
   */
  const writeOnlyForms = new Map([
    [join('components', 'CaseForm.tsx'), 'creates a case; the MRN input starts empty'],
    [join('components', 'QuickAddCase.tsx'), 'creates a case; the MRN input starts empty'],
  ]);

  function viewFiles(dir: string, found: string[] = []): string[] {
    for (const item of readdirSync(dir)) {
      if (item === 'node_modules' || item === '.next' || item === '__tests__') continue;
      const full = join(dir, item);
      if (statSync(full).isDirectory()) viewFiles(full, found);
      else if (item.endsWith('.tsx')) found.push(full);
    }
    return found;
  }

  /** Every source file, not just views: a projection can live in a lib module. */
  function walk(dir: string, found: string[] = []): string[] {
    for (const item of readdirSync(dir)) {
      if (item === 'node_modules' || item === '.next' || item === '__tests__') continue;
      const full = join(dir, item);
      if (statSync(full).isDirectory()) walk(full, found);
      else if (/\.tsx?$/.test(item)) found.push(full);
    }
    return found;
  }

  it('routes every rendered MRN or DOB through the audited reveal', () => {
    const offenders: string[] = [];
    const staleExemptions: string[] = [];

    for (const file of viewFiles(webRoot)) {
      const relative = file.slice(webRoot.length + 1);
      if (auditedRenderers.has(relative)) continue;

      const source = readFileSync(file, 'utf8');
      if (!/patient_mrn|patient_dob/.test(source)) continue;

      if (writeOnlyForms.has(relative)) {
        // The exemption is only valid while the field really does start empty:
        // a pre-loaded stored value would make it a disclosure surface.
        if (!/useState\(''\)/.test(source)) staleExemptions.push(relative);
        continue;
      }

      // A view that touches these columns must obtain them through the audited
      // reveal, so every disclosure it can render has a phi_view audit row.
      if (!/PhiFieldCell|PhiFields/.test(source)) offenders.push(relative);
    }

    expect(offenders, 'PHI columns must render through PhiFieldCell, not the raw row')
      .toEqual([]);
    expect(
      staleExemptions,
      'a write-only exemption must not keep a form that pre-loads a stored PHI value',
    ).toEqual([]);
  });

  it('masks by default and reveals only after the audit write succeeds', () => {
    const cell = readFileSync(join(webRoot, 'components', 'PhiFieldCell.tsx'), 'utf8');

    expect(cell).toContain('revealCasePhiField');
    expect(cell).toContain('***-**-');
    // The reveal is gated on the audit result, so a rejected write leaves the
    // value masked instead of disclosing it.
    expect(cell).toMatch(
      /if \(result\.value === null\) \{[\s\S]*?setError\([\s\S]*?return;[\s\S]*?\}/,
    );
    expect(cell.indexOf('setValue(result.value)')).toBeGreaterThan(
      cell.indexOf('if (result.value === null)'),
    );
  });

  it('does not accept the identifier as a prop, so no payload carries it', () => {
    const cell = readFileSync(join(webRoot, 'components', 'PhiFieldCell.tsx'), 'utf8');

    // If the value could arrive as a prop it would already be in the payload,
    // and the audit row would describe a disclosure that had already happened.
    expect(cell).not.toMatch(/value\??:\s*string\s*\|\s*null/);
    expect(cell).not.toContain('patient_mrn');
    expect(cell).not.toContain('patient_dob');
  });

  it('keeps the identifiers out of every projection except the audited action', () => {
    // The identifier is fetched per field through the audited action, so the
    // only file allowed to name the columns in a select is that action.
    const offenders: string[] = [];
    const actionPath = join('lib', 'cases', 'phi-reveal-actions.ts');

    for (const file of walk(webRoot)) {
      const relative = file.slice(webRoot.length + 1);
      if (relative === actionPath) continue;
      if (relative.startsWith(join('lib', 'audit'))) continue;

      if (/select\([^)]*\bpatient_(mrn|dob)\b/.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative);
      }
    }

    expect(offenders, 'only the audited reveal action may select a direct identifier')
      .toEqual([]);
  });

  it('records the disclosure before returning, and leaves authorization to RLS', () => {
    const action = readFileSync(join(webRoot, 'lib', 'cases', 'phi-reveal-actions.ts'), 'utf8');

    expect(action).toContain("'use server'");
    // The audit write gates the return value.
    expect(action.indexOf('recordPhiView(')).toBeLessThan(action.indexOf('return { value }'));
    expect(action).toContain('audit_failed');
    expect(action).toContain('deidentified');
    // A service-role client would bypass the row policies that decide what this
    // caller may see, turning a read helper into a cross-tenant read.
    expect(action).not.toContain('createServiceRoleClient');
  });

  it('does not pre-load the stored MRN or DOB into an editor input', () => {
    const editor = readFileSync(join(webRoot, 'components', 'CaseEditForm.tsx'), 'utf8');

    // The stored value reaches the input only through the audited reveal.
    expect(editor).not.toMatch(/useState\(entry\.patient_mrn/);
    expect(editor).not.toMatch(/useState\(entry\.patient_dob/);
    expect(editor).toContain('PhiFieldCell');
    // Each column is tracked separately, so editing the MRN cannot commit an
    // empty DOB and erase a stored clinical value this editor never saw.
    expect(editor).toContain('mrnTouched');
    expect(editor).toContain('dobTouched');
    // The DOB has its own audited reveal, so an MRN disclosure is not the
    // warrant for showing the date of birth.
    expect(editor).toMatch(/field="dob"/);
  });
});
