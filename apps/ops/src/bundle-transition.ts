/**
 * Supabase bundle-transition qualification (T15, bounded substep).
 *
 * Decides whether a bundle update may proceed to staged execution:
 * proceed | blocked (fixable preconditions) | unsupported-manual
 * (guided procedure only — never auto-applied to the live stack).
 * Actual staging, rehearsal, and service verification are T15-full
 * (needs VPS + restored clone).
 */

import { validateReleasePin, type ReleasePin } from './release-pin.js';
import type { MergeConflict } from './config-merge.js';

export type TransitionDecision =
  | { decision: 'proceed' }
  | { decision: 'blocked'; reasons: string[] }
  | { decision: 'unsupported-manual'; reasons: string[] };

export function qualifyBundleTransition(args: {
  current: ReleasePin;
  target: ReleasePin;
  mergeConflicts: MergeConflict[];
  upstreamBreakingSteps: string[];
  acknowledgedBreakingSteps: string[];
  rehearsalPassed: boolean;
  majorPostgresUpgrade: boolean;
}): TransitionDecision {
  const blocked: string[] = [];

  const targetPin = validateReleasePin(args.target);
  if (!targetPin.ok) {
    blocked.push(`target bundle is not pinned: ${targetPin.errors.join('; ')}`);
  }
  if (args.mergeConflicts.length > 0) {
    blocked.push(
      `unresolved config conflicts: ${args.mergeConflicts.map((c) => c.key).join(', ')} — resolve before staging`,
    );
  }
  if (blocked.length > 0) return { decision: 'blocked', reasons: blocked };

  const manual: string[] = [];
  if (args.majorPostgresUpgrade) {
    manual.push('major Postgres upgrade: guided maintenance procedure only, until that exact transition is rehearsed');
  }
  const unacked = args.upstreamBreakingSteps.filter((s) => !args.acknowledgedBreakingSteps.includes(s));
  if (unacked.length > 0) {
    manual.push(`unacknowledged upstream breaking steps: ${unacked.join('; ')}`);
  } else if (args.upstreamBreakingSteps.length > 0 && !args.rehearsalPassed) {
    return {
      decision: 'blocked',
      reasons: ['breaking steps acknowledged but restored-clone rehearsal has not passed'],
    };
  }
  if (manual.length > 0) return { decision: 'unsupported-manual', reasons: manual };

  return { decision: 'proceed' };
}
