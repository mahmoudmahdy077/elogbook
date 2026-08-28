'use client';
/**
 * Intent Ledger — Chain of Custody hidden-CTA engine.
 * Tracks visitor engagement signals as weighted points toward a capture sheet.
 * Truthful: every signal maps to a real user action; sheet copy states progress.
 * No-JS degrade: page works fully without this module (static CTAs remain).
 */

export type Role = 'resident' | 'director' | 'institution';

const KEY_INTENT = 'elog_intent_v1';

export interface IntentState {
  ticks: number;          // sections registered on the rail (hero pre-endowed)
  earnedPoints: number;   // real interactions: hash typed, demo completed, vault opened
  hashTyped: boolean;
  demoCompleted: boolean;
  vaultEngaged: boolean;
  dwellPillShown: boolean;
  sheetDismissedSession: boolean;
  pdfUnlocked: boolean;
  role: Role | null;
}

const INITIAL: IntentState = {
  ticks: 0,
  earnedPoints: 0,
  hashTyped: false,
  demoCompleted: false,
  vaultEngaged: false,
  dwellPillShown: false,
  sheetDismissedSession: false,
  pdfUnlocked: false,
  role: null,
};

function read(): IntentState {
  if (typeof window === 'undefined') return { ...INITIAL };
  try {
    const raw = window.sessionStorage.getItem(KEY_INTENT);
    return raw ? { ...INITIAL, ...(JSON.parse(raw) as Partial<IntentState>) } : { ...INITIAL };
  } catch {
    return { ...INITIAL };
  }
}

function write(s: IntentState): void {
  try {
    window.sessionStorage.setItem(KEY_INTENT, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('elog:intent', { detail: summarize(s) }));
  } catch {
    /* storage unavailable — engine silently no-ops */
  }
}

export interface IntentSummary extends IntentState {
  score: number;          // ticks + earned weights (vault counts double)
  sheetEligible: boolean;
}

export function summarize(s: IntentState): IntentSummary {
  const weighted =
    s.ticks +
    (s.hashTyped ? 1 : 0) +
    (s.demoCompleted ? 1 : 0) +
    (s.vaultEngaged ? 2 : 0); // director-weighted
  // NOVA fix: reading alone must not qualify — require ≥1 earned interaction point
  const hasEarnedInteraction = s.hashTyped || s.demoCompleted || s.vaultEngaged;
  const standardLane = weighted >= 6 && hasEarnedInteraction;
  const earlyLane = weighted >= 4 && (s.hashTyped || s.demoCompleted);
  return {
    ...s,
    score: weighted,
    sheetEligible:
      !s.sheetDismissedSession && !s.pdfUnlocked && (standardLane || earlyLane),
  };
}

export function getState(): IntentSummary {
  return summarize(read());
}

/** Register a section tick on the rail. Hero calls this once on mount (endowed). */
export function registerTick(sectionIndex: number, total: number): IntentSummary {
  const s = read();
  s.ticks = Math.max(s.ticks, Math.min(sectionIndex, total));
  const next = summarize(s);
  write(s);
  return next;
}

export function markHashTyped(minChars = 12): IntentSummary {
  const s = read();
  if (!s.hashTyped) s.hashTyped = true;
  void minChars;
  const next = summarize(s);
  write(s);
  return next;
}

export function markDemoCompleted(): IntentSummary {
  const s = read();
  s.demoCompleted = true;
  const next = summarize(s);
  write(s);
  return next;
}

export function markVaultEngaged(): IntentSummary {
  const s = read();
  s.vaultEngaged = true;
  const next = summarize(s);
  write(s);
  return next;
}

export function setRole(role: Role): IntentSummary {
  const s = read();
  s.role = role;
  write(s);
  return summarize(s);
}

export function getRole(): Role | null {
  return read().role;
}

export function markSheetDismissed(): IntentSummary {
  const s = read();
  s.sheetDismissedSession = true;
  write(s);
  return summarize(s);
}

export function markPdfUnlocked(): IntentSummary {
  const s = read();
  s.pdfUnlocked = true;
  write(s);
  return summarize(s);
}

export function markDwellPillShown(): void {
  const s = read();
  s.dwellPillShown = true;
  write(s);
}

export function shouldShowDwellPill(): boolean {
  const s = read();
  return !s.dwellPillShown && !s.pdfUnlocked && !s.sheetDismissedSession && s.ticks >= 1;
}
