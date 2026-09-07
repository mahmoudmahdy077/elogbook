/**
 * Update-plan builder (T14, bounded substep).
 *
 * Given the installed version and a target release record, produces the
 * ordered step list plus the rollback classification the adjudication
 * requires: image-only vs schema-compatible vs restore-based, irreversible
 * migrations, maximum window, expected data loss, and exact operator
 * action. A plan that cannot state these is BLOCKED, not "compatible".
 *
 * Execution (fencing writers, running migrations, switching traffic,
 * verifying candidates) belongs to the review-gated executor (T10-full)
 * and the qualified release flow (T13-full). This module never touches a host.
 */

export interface PlannedMigration {
  id: string;
  reversible: boolean;
}

export interface TargetRelease {
  version: string;
  compatibleFrom: string[];
  requiresMaintenance: boolean;
  backupRequired: boolean;
  migrations: PlannedMigration[];
  maxRollbackWindowHours: number;
}

export type PlanStepKind =
  | 'preflight'
  | 'backup'
  | 'verify-backup'
  | 'stage'
  | 'maintenance'
  | 'migrate'
  | 'candidate-verify'
  | 'switch'
  | 'drain';

export type RollbackStrategy = 'image-only' | 'schema-compatible' | 'restore-based';

export interface RollbackPlan {
  strategy: RollbackStrategy;
  irreversibleMigrations: string[];
  maxWindowHours: number;
  expectedDataLoss: string;
  operatorAction: string;
}

export interface UpdatePlan {
  steps: { kind: PlanStepKind; migrationIds?: string[] }[];
  rollback: RollbackPlan | null;
  /** Non-null when no plan may be produced. */
  blocked: string | null;
}

export function buildUpdatePlan(args: {
  currentVersion: string;
  target: TargetRelease;
  backupAvailable: boolean;
}): UpdatePlan {
  const { currentVersion, target, backupAvailable } = args;

  if (!target.compatibleFrom.includes(currentVersion)) {
    return {
      steps: [],
      rollback: null,
      blocked: `target ${target.version} is not compatible with installed ${currentVersion}; qualified intermediate hop required`,
    };
  }
  if (target.backupRequired && !backupAvailable) {
    return {
      steps: [],
      rollback: null,
      blocked: 'required verified pre-update backup is missing; back up before planning',
    };
  }

  const steps: UpdatePlan['steps'] = [
    { kind: 'preflight' },
    { kind: 'backup' },
    { kind: 'verify-backup' },
    { kind: 'stage' },
  ];
  if (target.requiresMaintenance) steps.push({ kind: 'maintenance' });
  if (target.migrations.length > 0) {
    steps.push({ kind: 'migrate', migrationIds: target.migrations.map((m) => m.id) });
  }
  steps.push({ kind: 'candidate-verify' }, { kind: 'switch' }, { kind: 'drain' });

  const irreversibleMigrations = target.migrations.filter((m) => !m.reversible).map((m) => m.id);
  const rollback: RollbackPlan =
    irreversibleMigrations.length > 0
      ? {
          strategy: 'restore-based',
          irreversibleMigrations,
          maxWindowHours: target.maxRollbackWindowHours,
          expectedDataLoss:
            'all writes since the recovery point are lost; restores to the verified pre-update backup',
          operatorAction:
            'fence writers (maintenance mode), restore backup into place, verify readiness, re-enable traffic',
        }
      : target.migrations.length > 0
        ? {
            strategy: 'schema-compatible',
            irreversibleMigrations: [],
            maxWindowHours: target.maxRollbackWindowHours,
            expectedDataLoss: 'none expected: schema is forward- and backward-compatible within the window',
            operatorAction: 'switch proxy traffic back to the previous image and drain the candidate',
          }
        : {
            strategy: 'image-only',
            irreversibleMigrations: [],
            maxWindowHours: target.maxRollbackWindowHours,
            expectedDataLoss: 'none: no schema change shipped',
            operatorAction: 'switch proxy traffic back to the previous image and drain the candidate',
          };

  return { steps, rollback, blocked: null };
}
