import { describe, it, expect, vi } from 'vitest';

// Mock WatermelonDB + adapter + models for node test environment
vi.mock('@nozbe/watermelondb', () => {
  class MockDatabase {
    write = vi.fn();
    get = vi.fn();
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

import { getDatabase, initDatabase } from '../database';

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
});
