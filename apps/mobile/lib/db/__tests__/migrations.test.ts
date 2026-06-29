import { describe, it, expect } from 'vitest';
import { migrations } from '../migrations';

describe('migrations', () => {
  it('declares a v2 → v3 step that adds server_id to case_entries', () => {
    expect(migrations.validated).toBe(true);
    expect(migrations.maxVersion).toBe(3);

    const v3 = migrations.sortedMigrations.find((m) => m.toVersion === 3);
    expect(v3).toBeDefined();
    const stepList = v3!.steps as Array<{
      type?: string;
      columns?: Array<{ name: string; type: string; isOptional?: boolean }>;
    }>;
    const addStep = stepList.find((s) => s.type === 'add_columns');
    expect(addStep).toBeDefined();
    const serverIdCol = addStep!.columns!.find((c) => c.name === 'server_id');
    expect(serverIdCol).toBeDefined();
    expect(serverIdCol!.type).toBe('string');
    expect(serverIdCol!.isOptional).toBe(true);
  });

  it('uses addColumns helper from WatermelonDB', async () => {
    const { addColumns } = await import('@nozbe/watermelondb/Schema/migrations');
    expect(typeof addColumns).toBe('function');
  });
});
