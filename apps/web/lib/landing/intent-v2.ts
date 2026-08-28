'use client';

/**
 * Chain of Custody v2 — Intent Ledger (session logbook entry engine).
 * Tracks visitor engagement signals as banked points toward a single
 * per-session capture offer. Truthful: every signal maps to a real user
 * action; sheet copy states progress plainly. No-JS degrade: the page is
 * complete without this module (static CTAs remain).
 * MASTER DIRECTION v2 rulings honored:
 *  - banking (click 2 of demo) is instant; the OFFER never interrupts.
 *  - offer fires once/session: exit-intent or scroll-past-demo gate, >=4 signals.
 *  - no dwell surveillance, no receipt language, no loss-aversion verbs.
 */

export type Role = 'resident' | 'director';

const KEY_INTENT = 'elog_intent_v2';
const KEY_OFFERED = 'elog_offer_v2';

export interface IntentState {
  heroSeen: boolean;
  hashTyped: boolean;
  demoApproved1: boolean;
  demoApproved2: boolean;
  vaultExpanded: boolean;
  offeredThisSession: boolean;
  acceptedThisSession: boolean;
  role: Role | null;
}

export const INITIAL_INTENT: IntentState = {
  heroSeen: false,
  hashTyped: false,
  demoApproved1: false,
  demoApproved2: false,
  vaultExpanded: false,
  offeredThisSession: false,
  acceptedThisSession: false,
  role: null,
};

/** Weighted signals per master-direction.md: hero +1, hash +1, approvals +1 each, vault +2. */
export function scoreIntent(s: IntentState): number {
  return (
    (s.heroSeen ? 1 : 0) +
    (s.hashTyped ? 1 : 0) +
    (s.demoApproved1 ? 1 : 0) +
    (s.demoApproved2 ? 1 : 0) +
    (s.vaultExpanded ? 2 : 0)
  );
}

export function summarize(s: IntentState): string[] {
  const lines: string[] = [];
  if (s.hashTyped || s.heroSeen) lines.push('Read what unreviewed work costs');
  if (s.demoApproved1 && s.demoApproved2) lines.push('Ran the two-click review yourself');
  else if (s.demoApproved1 || s.demoApproved2) lines.push('Started the two-click review');
  if (s.vaultExpanded) lines.push('Opened the security vault');
  return lines;
}

function read(): IntentState {
  if (typeof window === 'undefined') return { ...INITIAL_INTENT };
  try {
    const raw = window.sessionStorage.getItem(KEY_INTENT);
    return raw ? { ...INITIAL_INTENT, ...(JSON.parse(raw) as Partial<IntentState>) } : { ...INITIAL_INTENT };
  } catch {
    return { ...INITIAL_INTENT };
  }
}

function write(s: IntentState): void {
  try {
    window.sessionStorage.setItem(KEY_INTENT, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('elog:intent', { detail: { score: scoreIntent(s), state: s } }));
  } catch {
    /* storage unavailable — session stays stateless; capture simply won't fire */
  }
}

export function getIntent(): IntentState {
  return read();
}

export function markHeroSeen(): void {
  const s = read();
  if (!s.heroSeen) write({ ...s, heroSeen: true });
}

export function markHashTyped(): void {
  const s = read();
  if (!s.hashTyped) write({ ...s, hashTyped: true });
}

export function markDemoApproved(which: 1 | 2): void {
  const s = read();
  write(which === 1 ? { ...s, demoApproved1: true } : { ...s, demoApproved2: true });
}

export function markVaultExpanded(): void {
  const s = read();
  if (!s.vaultExpanded) write({ ...s, vaultExpanded: true });
}

export function markRole(role: Role): void {
  const s = read();
  write({ ...s, role });
}

/** Banked entry line for the capture payload; under /api/contact 5000-char cap. */
export function entryPayload(role: Role | null): string {
  const s = read();
  return `entry:${summarize(s).join('; ')}|role:${role ?? 'unknown'}`;
}

export function wasOffered(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.sessionStorage.getItem(KEY_OFFERED) === '1';
  } catch {
    return true;
  }
}

export function markOffered(): void {
  try {
    window.sessionStorage.setItem(KEY_OFFERED, '1');
    const s = read();
    write({ ...s, offeredThisSession: true });
  } catch {
    /* noop */
  }
}

export function markAccepted(): void {
  const s = read();
  write({ ...s, acceptedThisSession: true });
}
