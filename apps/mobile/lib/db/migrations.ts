import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'case_entries',
          columns: [{ name: 'server_id', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [],
    },
    {
      toVersion: 5,
      steps: [
        // Add sync metadata columns to ALL 8 tables
        ...['case_entries', 'case_templates', 'program_goals', 'rotations', 'milestones', 'evaluation_forms', 'comments', 'shifts'].flatMap((table) => [
          addColumns({ table, columns: [
            { name: 'server_updated_at', type: 'number', isOptional: true },
            { name: 'is_deleted', type: 'boolean' },
          ] }),
        ]),
        // Add server_id + local_sync_status to tables that don't have them yet
        ...['case_templates', 'program_goals', 'rotations', 'milestones', 'evaluation_forms', 'comments', 'shifts'].flatMap((table) => [
          addColumns({ table, columns: [
            { name: 'server_id', type: 'string', isOptional: true },
            { name: 'local_sync_status', type: 'string' },
          ] }),
        ]),
      ],
    },
  ],
});
