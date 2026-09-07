import { describe, it, expect } from 'vitest';
import { SETUP_STEPS, setupProgress, type SetupStepState } from '../setup-progress';

// T12 (bounded): the 9-step bootstrap model from section 5.3. The GUI
// (T12-full) renders this; the manager (T10-full) persists it. Pure here.
describe('setupProgress (T12)', () => {
  const fresh = (): SetupStepState[] => SETUP_STEPS.map((s) => ({ id: s.id, status: 'pending' as const }));

  it('fresh installation starts before step 1 with no failures', () => {
    const p = setupProgress(fresh());
    expect(p.overall).toBe('in-progress');
    expect(p.currentStepId).toBe('claim');
    expect(p.failed).toEqual([]);
    expect(p.canRetry).toBe(false);
  });

  it('completed prefix advances the current step', () => {
    const states = fresh();
    states[0] = { id: 'claim', status: 'done' };
    states[1] = { id: 'preflight', status: 'done' };
    const p = setupProgress(states);
    expect(p.currentStepId).toBe('domains');
  });

  it('a failed step blocks with retry allowed and later steps untouched', () => {
    const states = fresh();
    states[0] = { id: 'claim', status: 'done' };
    states[1] = { id: 'preflight', status: 'failed', error: 'disk full' };
    const p = setupProgress(states);
    expect(p.overall).toBe('failed');
    expect(p.failed).toEqual(['preflight']);
    expect(p.canRetry).toBe(true);
    expect(p.currentStepId).toBe('preflight');
  });

  it('all steps done closes bootstrap (credentials must die here)', () => {
    const p = setupProgress(SETUP_STEPS.map((s) => ({ id: s.id, status: 'done' as const })));
    expect(p.overall).toBe('complete');
    expect(p.currentStepId).toBeNull();
    expect(p.bootstrapOpen).toBe(false);
  });

  it('irreversible steps are flagged for confirmation UI', () => {
    const irreversible = SETUP_STEPS.filter((s) => !s.reversible).map((s) => s.id);
    expect(irreversible).toContain('provision');
    expect(irreversible).toContain('close');
    expect(irreversible).not.toContain('preflight');
  });

  it('unknown step ids fail closed', () => {
    expect(() => setupProgress([{ id: 'nope', status: 'done' }])).toThrow(/unknown setup step/);
  });
});
