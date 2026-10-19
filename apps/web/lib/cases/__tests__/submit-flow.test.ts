import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCaseDraftAndSubmit, type InsertDraftResult, type SubmitCommandResult, type SubmitFlowDeps } from '../submit-flow';

const baseInput = {
  templateId: 'tpl-1',
  caseDate: '2026-09-20',
  fieldValues: { procedure: 'lap chole' },
  accreditationMappings: [] as unknown[],
  isDeidentified: true,
  patientColumns: { patient_mrn: null, patient_dob: null, patient_age_years: 34 },
  tenantId: 't-1',
  residentId: 'p-1',
  requestId: 'req-1',
};

function makeDeps(overrides: Partial<SubmitFlowDeps> = {}) {
  const insertDraft = vi.fn<(row: Record<string, unknown>) => Promise<InsertDraftResult>>()
    .mockResolvedValue({ id: 'case-1', error: null });
  const submitCommand = vi.fn<
    (args: { caseId: string; requestId: string; expectedStatus: string }) => Promise<SubmitCommandResult>
  >().mockResolvedValue({ status: 200, body: { success: true, case_id: 'case-1' } });
  return { insertDraft, submitCommand, ...overrides } as SubmitFlowDeps & {
    insertDraft: typeof insertDraft;
    submitCommand: typeof submitCommand;
  };
}

describe('createCaseDraftAndSubmit', () => {
  it('always creates the draft in draft status, never a client-chosen approval state', async () => {
    const deps = makeDeps();

    await createCaseDraftAndSubmit(deps, baseInput);

    const row = deps.insertDraft.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe('draft');
  });

  it('never asks the client to choose an initial status', async () => {
    const deps = makeDeps();

    await createCaseDraftAndSubmit(deps, baseInput);

    const row = deps.insertDraft.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row)).not.toContain('initialStatus');
  });

  it('submits the new draft through the command with the request id', async () => {
    const deps = makeDeps();

    await createCaseDraftAndSubmit(deps, baseInput);

    expect(deps.submitCommand).toHaveBeenCalledWith({
      caseId: 'case-1',
      requestId: 'req-1',
      expectedStatus: 'draft',
    });
  });

  it('reuses one request id so a retry cannot duplicate the case', async () => {
    const deps = makeDeps();

    await createCaseDraftAndSubmit(deps, baseInput);
    await createCaseDraftAndSubmit(deps, baseInput);

    const ids = deps.submitCommand.mock.calls.map(
      (call: [{ requestId: string }]) => call[0].requestId,
    );
    expect(new Set(ids)).toEqual(new Set(['req-1']));
  });

  it('reports submission when the command moves the case to pending', async () => {
    const result = await createCaseDraftAndSubmit(makeDeps(), baseInput);

    expect(result).toEqual({ outcome: 'submitted', caseId: 'case-1' });
  });

  it('keeps the case as a draft and reports the reason when no reviewer exists', async () => {
    const deps = makeDeps({
      submitCommand: vi.fn().mockResolvedValue({
        status: 403,
        body: { success: false, code: 'no_eligible_reviewer', error: 'no eligible reviewer' },
      }),
    });

    const result = await createCaseDraftAndSubmit(deps, baseInput);

    expect(result).toEqual({ outcome: 'draft_only', caseId: 'case-1', code: 'no_eligible_reviewer' });
  });

  it('keeps the case as a draft when the command reports a state conflict', async () => {
    const deps = makeDeps({
      submitCommand: vi.fn().mockResolvedValue({
        status: 409,
        body: { success: false, code: 'state_conflict', error: 'already moved on' },
      }),
    });

    const result = await createCaseDraftAndSubmit(deps, baseInput);

    expect(result).toEqual({ outcome: 'draft_only', caseId: 'case-1', code: 'state_conflict' });
  });

  it('does not submit when the draft insert failed', async () => {
    const deps = makeDeps({ insertDraft: vi.fn().mockResolvedValue({ id: null, error: 'insert rejected' }) });

    const result = await createCaseDraftAndSubmit(deps, baseInput);

    expect(result).toEqual({ outcome: 'error', message: 'insert rejected' });
    expect(deps.submitCommand).not.toHaveBeenCalled();
  });

  it('does not submit when the draft insert returned no id', async () => {
    const deps = makeDeps({ insertDraft: vi.fn().mockResolvedValue({ id: null, error: null }) });

    const result = await createCaseDraftAndSubmit(deps, baseInput);

    expect(result.outcome).toBe('error');
    expect(deps.submitCommand).not.toHaveBeenCalled();
  });

  it('returns the case id so the caller can link to the draft', async () => {
    const result = await createCaseDraftAndSubmit(makeDeps(), baseInput);

    expect((result as { caseId: string }).caseId).toBe('case-1');
  });
});

describe('clinical components never write a client-chosen status', () => {
  const repoRoot = resolve(process.cwd(), '..', '..');
  const caseForm = readFileSync(resolve(repoRoot, 'apps/web/components/CaseForm.tsx'), 'utf8');
  const quickAddCase = readFileSync(resolve(repoRoot, 'apps/web/components/QuickAddCase.tsx'), 'utf8');
  const newCasePage = readFileSync(resolve(repoRoot, 'apps/web/app/(authenticated)/[tenant]/cases/new/page.tsx'), 'utf8');

  it('CaseForm does not insert an approved or pending case directly', () => {
    expect(caseForm).not.toMatch(/status:\s*'approved'/);
    expect(caseForm).not.toMatch(/status:\s*'pending'/);
  });

  it('QuickAddCase does not insert an approved or pending case directly', () => {
    expect(quickAddCase).not.toMatch(/status:\s*'approved'/);
    expect(quickAddCase).not.toMatch(/status:\s*'pending'/);
  });

  it('the new-case page no longer computes a client-chosen initial status', () => {
    expect(newCasePage).not.toContain('initialStatus');
  });

  it('CaseForm routes submission through the submit_case command path', () => {
    expect(caseForm).toContain('createCaseDraftAndSubmit');
    expect(caseForm).toContain('/submit');
  });

  it('QuickAddCase routes submission through the submit_case command path', () => {
    expect(quickAddCase).toContain('createCaseDraftAndSubmit');
    expect(quickAddCase).toContain('/submit');
  });
});
