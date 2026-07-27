import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'case_entries',
          columns: [
            { name: 'server_id', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [], // No schema changes in v4 — just advancing the version to match schema.ts
    },
  ],
});
