import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      getAllKeys: async () => [...store.keys()],
      clear: async () => { store.clear(); },
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getAccountContext,
  setAccountContext,
  clearAccountContext,
  primeAccountContext,
  scopedKey,
  onContextChange,
} from '../account-context';

const IDENTITY = { userId: 'u1', tenantId: 't1', profileId: 'p1' } as const;

/**
 * The epoch write is deliberately not awaited by the constructor, so a test that
 * inspects storage has to let the microtask queue drain first. The assertion is
 * about the key and its scope, not about the moment the write landed.
 */
async function flushWrites(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

beforeEach(async () => {
  await AsyncStorage.clear();
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

describe('account-context — the durable session discriminator', () => {
  it('does not reuse a session key for two independently constructed contexts after a restart', async () => {
    // First process: one context, one session.
    await primeAccountContext(IDENTITY);
    setAccountContext(IDENTITY);
    const first = getAccountContext()?.sessionId;
    expect(first).toBeTruthy();

    // Simulated restart: the module is reloaded, so the in-memory counter is
    // gone, while AsyncStorage is the same device.
    vi.resetModules();
    const reloaded = await import('../account-context');
    await reloaded.primeAccountContext(IDENTITY);
    reloaded.setAccountContext(IDENTITY);

    expect(reloaded.getAccountContext()?.sessionId).toBeTruthy();
    expect(reloaded.getAccountContext()?.sessionId).not.toBe(first);
  });

  it('keeps the same key for the same identity within one session', async () => {
    await primeAccountContext(IDENTITY);
    setAccountContext(IDENTITY);
    const first = getAccountContext()?.sessionId;
    setAccountContext({ ...IDENTITY, role: 'resident' });
    expect(getAccountContext()?.sessionId).toBe(first);
  });

  it('keeps the durable record under the account scope so disposal removes it', async () => {
    await primeAccountContext(IDENTITY);
    setAccountContext(IDENTITY);
    await flushWrites();
    const keys = await AsyncStorage.getAllKeys();
    const epochKeys = keys.filter((key) => key.startsWith('u1:t1:') && key.includes('session'));
    expect(epochKeys).toEqual(['u1:t1:account_context.session_epoch.v1']);
    // No global or unscoped key: another account's record is not addressable.
    expect(keys.filter((key) => key.startsWith('global:'))).toEqual([]);
  });

  it('does not carry one account epoch into another', async () => {
    await primeAccountContext(IDENTITY);
    setAccountContext(IDENTITY);
    await flushWrites();
    const first = getAccountContext()?.sessionId;

    const other = { userId: 'u2', tenantId: 't1', profileId: 'p2' } as const;
    await primeAccountContext(other);
    setAccountContext(other);
    const second = getAccountContext()?.sessionId;

    expect(second).not.toBe(first);
    expect(String(second).startsWith('u2:t1:p2:')).toBe(true);
    const stored = await AsyncStorage.getItem('u1:t1:account_context.session_epoch.v1');
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('u2');
  });

  it('never reuses a key even when the durable record is unreadable', async () => {
    vi.resetModules();
    const reloaded = await import('../account-context');
    // No prime: the allocator has nothing durable to read and must still not
    // hand out a discriminator a previous process could have used.
    reloaded.setAccountContext(IDENTITY);
    const unprimed = reloaded.getAccountContext()?.sessionId;
    reloaded.clearAccountContext();
    reloaded.setAccountContext(IDENTITY);
    const next = reloaded.getAccountContext()?.sessionId;
    expect(next).not.toBe(unprimed);
  });
});
