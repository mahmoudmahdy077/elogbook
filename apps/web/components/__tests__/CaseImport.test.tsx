import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// CSV import writes de-identified clinical rows. The component must therefore
// project the file through the validated template schema and stop on the first
// refusal instead of forwarding raw columns to the draft command.

const state = vi.hoisted(() => ({
  templates: [] as { id: string; name: string; fields: unknown }[],
  saveCaseDraft: vi.fn(),
  newRequestId: vi.fn(() => 'req-1'),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ data: state.templates, error: null }),
      }),
    }),
  }),
}));

vi.mock('@/lib/cases/submit-flow', () => ({
  newRequestId: () => state.newRequestId(),
  saveCaseDraft: (...args: unknown[]) => state.saveCaseDraft(...args),
}));

import CaseImport from '../CaseImport';
import { MAX_IMPORT_BYTES } from '@/lib/cases/import-rows';

const TEMPLATE_FIELDS = [
  { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
  { key: 'complexity', label: 'Complexity', type: 'number' },
];

function file(name: string, content: string): File {
  return new File([content], name, { type: 'text/csv' });
}

async function selectFile(selected: File) {
  render(
    <CaseImport
      isOpen
      onClose={() => {}}
      tenantId="tenant-1"
      tenantSlug="tenant-one"
    />,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [selected], configurable: true });
  fireEvent.change(input);
  return input;
}

beforeEach(() => {
  cleanup();
  state.saveCaseDraft.mockReset();
  state.newRequestId.mockReturnValue('req-1');
  state.templates = [{ id: 'template-1', name: 'General', fields: TEMPLATE_FIELDS }];
  state.saveCaseDraft.mockResolvedValue({ id: 'case-1', error: null });
});

afterEach(() => {
  cleanup();
});

describe('CaseImport bounded intake', () => {
  it('refuses a file larger than the byte budget before any draft is created', async () => {
    const oversized = file('big.csv', `diagnosis\n${'x'.repeat(MAX_IMPORT_BYTES)}`);
    await selectFile(oversized);

    expect(await screen.findByText(/limited to 2 MB/i)).toBeInTheDocument();
    expect(state.saveCaseDraft).not.toHaveBeenCalled();
  });
});

describe('CaseImport validated projection', () => {
  it('sends only declared template fields to the draft command', async () => {
    await selectFile(file('cases.csv', 'case_date,diagnosis,complexity\n2026-09-01,appendicitis,3'));

    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: /import 1 case/i },
        { timeout: 10_000 },
      ),
    );

    await waitFor(() => expect(state.saveCaseDraft).toHaveBeenCalledTimes(1));
    const [slug, row] = state.saveCaseDraft.mock.calls[0] as [string, Record<string, unknown>];
    expect(slug).toBe('tenant-one');
    expect(row.field_values).toEqual({ diagnosis: 'appendicitis', complexity: 3 });
    expect(row.case_date).toBe('2026-09-01');
    expect(row.is_deidentified).toBe(true);
  });

  it('refuses an undeclared column instead of writing it into field_values', async () => {
    await selectFile(file('cases.csv', 'diagnosis,smuggled_column\nappendicitis,leak'));

    expect(await screen.findByText(/not a field on the selected template/i)).toBeInTheDocument();
    expect(state.saveCaseDraft).not.toHaveBeenCalled();
  });

  it('refuses an identifier column', async () => {
    await selectFile(file('cases.csv', 'diagnosis,patient_mrn\nappendicitis,123456'));

    expect(await screen.findByText(/patient identifiers/i)).toBeInTheDocument();
    expect(state.saveCaseDraft).not.toHaveBeenCalled();
  });

  it('refuses a spreadsheet formula', async () => {
    await selectFile(file('cases.csv', 'diagnosis\n=cmd|calc'));

    expect(await screen.findByText(/spreadsheet formula/i)).toBeInTheDocument();
    expect(state.saveCaseDraft).not.toHaveBeenCalled();
  });

  it('refuses an identifier-shaped value in a de-identified field', async () => {
    await selectFile(file('cases.csv', 'diagnosis\npatient 1234567'));

    expect(await screen.findByText(/de-identified cases only/i)).toBeInTheDocument();
    expect(state.saveCaseDraft).not.toHaveBeenCalled();
  });

  it('fails closed at intake when the tenant has no template', async () => {
    state.templates = [];
    await selectFile(file('cases.csv', 'diagnosis\nappendicitis'));

    // Refused before a preview is offered, so there is nothing to import from.
    expect(await screen.findByText(/no case templates exist/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import 1 case/i })).not.toBeInTheDocument();
    expect(state.saveCaseDraft).not.toHaveBeenCalled();
  });
});
