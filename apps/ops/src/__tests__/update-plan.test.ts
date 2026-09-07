import { describe, it, expect } from 'vitest';
import { buildUpdatePlan, type TargetRelease } from '../update-plan';

// T14 (bounded): update planning with explicit rollback classification.
// Execution (preflight/backup/fence/migrate/switch/verify) belongs to the
// review-gated executor; this module decides WHAT the plan is and HOW a
// rollback behaves. "Compatible rollback" without these fields is blocked.
describe('buildUpdatePlan (T14)', () => {
  const target: TargetRelease = {
    version: '1.2.0',
    compatibleFrom: ['1.1.0'],
    requiresMaintenance: false,
    backupRequired: true,
    migrations: [
      { id: '20260907000000_a.sql', reversible: true },
      { id: '20260907000001_b.sql', reversible: true },
    ],
    maxRollbackWindowHours: 72,
  };

  it('builds a compatible plan with schema-compatible rollback', () => {
    const plan = buildUpdatePlan({ currentVersion: '1.1.0', target, backupAvailable: true });
    expect(plan.blocked).toBeNull();
    expect(plan.steps.map((s) => s.kind)).toEqual([
      'preflight',
      'backup',
      'verify-backup',
      'stage',
      'migrate',
      'candidate-verify',
      'switch',
      'drain',
    ]);
    expect(plan.rollback?.strategy).toBe('schema-compatible');
    expect(plan.rollback?.irreversibleMigrations).toEqual([]);
    expect(plan.rollback?.maxWindowHours).toBe(72);
  });

  it('uses image-only rollback when no migrations ship', () => {
    const plan = buildUpdatePlan({
      currentVersion: '1.1.0',
      target: { ...target, migrations: [] },
      backupAvailable: true,
    });
    expect(plan.blocked).toBeNull();
    expect(plan.rollback?.strategy).toBe('image-only');
    expect(plan.steps.some((s) => s.kind === 'migrate')).toBe(false);
  });

  it('requires restore-based rollback with data-loss statement for irreversible migrations', () => {
    const plan = buildUpdatePlan({
      currentVersion: '1.1.0',
      target: {
        ...target,
        migrations: [{ id: '20260907000000_drop.sql', reversible: false }],
      },
      backupAvailable: true,
    });
    expect(plan.blocked).toBeNull();
    expect(plan.rollback?.strategy).toBe('restore-based');
    expect(plan.rollback?.irreversibleMigrations).toEqual(['20260907000000_drop.sql']);
    expect(plan.rollback?.expectedDataLoss).toMatch(/writes since the recovery point/i);
    expect(plan.rollback?.operatorAction).toMatch(/fence|maintenance/i);
  });

  it('blocks incompatible transitions instead of planning them', () => {
    const plan = buildUpdatePlan({ currentVersion: '0.9.0', target, backupAvailable: true });
    expect(plan.steps).toEqual([]);
    expect(plan.rollback).toBeNull();
    expect(plan.blocked).toMatch(/not compatible/i);
  });

  it('blocks when the required pre-update backup is missing', () => {
    const plan = buildUpdatePlan({ currentVersion: '1.1.0', target, backupAvailable: false });
    expect(plan.steps).toEqual([]);
    expect(plan.blocked).toMatch(/backup/i);
  });

  it('adds maintenance fencing when the release requires it', () => {
    const plan = buildUpdatePlan({
      currentVersion: '1.1.0',
      target: { ...target, requiresMaintenance: true },
      backupAvailable: true,
    });
    expect(plan.blocked).toBeNull();
    expect(plan.steps.map((s) => s.kind)).toContain('maintenance');
  });
});
