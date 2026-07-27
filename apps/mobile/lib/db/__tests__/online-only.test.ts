import { describe, it, expect } from 'vitest';
import { getDatabase, initDatabase } from '../database';

describe('mobile DB — UXM-001 (v1 online-only)', () => {
  it('initDatabase throws with a clear message', async () => {
    await expect(initDatabase()).rejects.toThrow(/offline storage is disabled/i);
  });

  it('getDatabase throws when not initialized', () => {
    expect(() => getDatabase()).toThrow(/disabled/i);
  });
});
