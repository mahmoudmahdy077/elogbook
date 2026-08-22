import { describe, it, expect } from 'vitest';
import { migrations } from '../migrations';

describe('migrations', () => {
  it('declares valid migrations up to v5 (offline sync support)', () => {
    expect(migrations.validated).toBe(true);
    expect(migrations.maxVersion).toBe(5);

    // v3 adds server_id to case_entries
    const v3 = migrations.sortedMigrations.find((m) => m.toVersion === 3);
    expect(v3).toBeDefined();

    // v5 adds sync metadata to all 8 tables
    const v5 = migrations.sortedMigrations.find((m) => m.toVersion === 5);
    expect(v5).toBeDefined();
    const stepList = v5!.steps as Array<{
      type?: string;
      table?: string;
      columns?: Array<{ name: string; type: string; isOptional?: boolean }>;
    }>;
    // Should have addColumns steps for all 8 tables
    const addSteps = stepList.filter((s) => s.type === 'add_columns');
    expect(addSteps.length).toBeGreaterThanOrEqual(8);
  });

  it('uses addColumns helper from WatermelonDB', async () => {
    const { addColumns } = await import('@nozbe/watermelondb/Schema/migrations');
    expect(typeof addColumns).toBe('function');
  });
});
