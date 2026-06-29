import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      // v2 → v3: track the server id assigned after a successful push so
      // subsequent `modified` updates use the server id (not the local UUID).
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
  ],
});
