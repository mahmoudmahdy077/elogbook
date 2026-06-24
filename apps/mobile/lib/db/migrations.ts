import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    // Schema v2 → v3: Add future columns here
    // {
    //   toVersion: 3,
    //   steps: [
    //     addColumns({
    //       table: 'case_entries',
    //       columns: [
    //         { name: 'region', type: 'string', isOptional: true },
    //       ],
    //     }),
    //   ],
    // },
  ],
});
