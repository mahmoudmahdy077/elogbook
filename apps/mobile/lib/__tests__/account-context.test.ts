import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAccountContext,
  setAccountContext,
  clearAccountContext,
  scopedKey,
  onContextChange,
} from '../account-context';

beforeEach(() => {
  clearAccountContext();
});

describe('account-context (M1)', () => {
  it('returns null when no account is set', () => {
    expect(getAccountContext()).toBeNull();
  });

  it('scopes keys by user and tenant', () => {
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    expect(scopedKey('case_form_draft')).toBe('u1:t1:case_form_draft');
  });

  it('falls back to global namespace when unset (legacy migration only)', () => {
    expect(scopedKey('case_form_draft')).toBe('global:case_form_draft');
  });

  it('notifies listeners on change and clear (for worker stop + wipe)', () => {
    const events: Array<string | null> = [];
    const off = onContextChange((ctx) => events.push(ctx ? `${ctx.userId}:${ctx.tenantId}` : null));
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    clearAccountContext();
    off();
    expect(events).toEqual(['u1:t1', 'u2:t1', null]);
  });

  it('switching account changes the scope so old drafts are not queryable', () => {
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    const k1 = scopedKey('case_form_draft');
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    const k2 = scopedKey('case_form_draft');
    expect(k1).not.toBe(k2);
  });
});
