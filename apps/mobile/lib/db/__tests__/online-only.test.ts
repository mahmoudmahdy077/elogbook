import { describe, it, expect, vi } from 'vitest';

// Mock WatermelonDB + adapter + models for node test environment
vi.mock('@nozbe/watermelondb', () => {
  class MockDatabase {
    write = vi.fn((work: () => Promise<unknown>) => work());
    get = vi.fn();
    unsafeResetDatabase = vi.fn(async () => undefined);
  }
  return { Database: MockDatabase };
});
vi.mock('@nozbe/watermelondb/adapters/sqlite', () => {
  class MockSQLiteAdapter {
    constructor(_opts: unknown) {}
  }
  return { default: MockSQLiteAdapter };
});
vi.mock('@nozbe/watermelondb/decorators', () => ({
  text: () => () => {},
  field: () => () => {},
  date: () => () => {},
  json: () => () => {},
}));
vi.mock('../schema', () => ({ schema: {} }));
vi.mock('../migrations', () => ({ migrations: {} }));
// Mock all model imports (they use WatermelonDB decorators)
vi.mock('../models/CaseEntry', () => ({ CaseEntry: class {} }));
vi.mock('../models/CaseTemplate', () => ({ CaseTemplate: class {} }));
vi.mock('../models/ProgramGoal', () => ({ ProgramGoal: class {} }));
vi.mock('../models/Rotation', () => ({ Rotation: class {} }));
vi.mock('../models/Milestone', () => ({ Milestone: class {} }));
vi.mock('../models/EvaluationForm', () => ({ EvaluationForm: class {} }));
vi.mock('../models/Comment', () => ({ Comment: class {} }));
vi.mock('../models/Shift', () => ({ Shift: class {} }));

import { getDatabase, initDatabase, resetDatabase, isPlaintextDatabasePathEnabled, assertLocalClinicalStorageAllowed } from '../database';

describe('mobile DB — v2 offline-enabled', () => {
  it('initDatabase returns a Database instance', async () => {
    const db = await initDatabase();
    expect(db).toBeDefined();
    expect(db).toHaveProperty('write');
  });

  it('getDatabase works after init', () => {
    const db = getDatabase();
    expect(db).toBeDefined();
  });

  it('initDatabase is idempotent (returns same instance)', async () => {
    const db1 = await initDatabase();
    const db2 = await initDatabase();
    expect(db1).toBe(db2);
  });

  it('resets the singleton before a new account can read old rows', async () => {
    const first = await initDatabase();
    await resetDatabase();
    expect(() => getDatabase()).toThrow(/not initialized/i);
    const second = await initDatabase();
    expect(second).not.toBe(first);
    expect(first.unsafeResetDatabase).toHaveBeenCalledTimes(1);
  });

  it('blocks the plaintext adapter in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(isPlaintextDatabasePathEnabled()).toBe(false);
      expect(() => assertLocalClinicalStorageAllowed()).toThrow(/disabled in production/i);
      expect(() => getDatabase()).toThrow(/disabled in production/i);
      await expect(initDatabase()).rejects.toThrow(/disabled in production/i);
      await expect(resetDatabase()).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else process.env.NODE_ENV = previous;
    }
  });
});
