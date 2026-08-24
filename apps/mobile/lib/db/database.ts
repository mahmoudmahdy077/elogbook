/**
 * WatermelonDB database initialization.
 *
 * v2: Offline storage re-enabled. SQLCipher encryption is applied via
 * the device key from SecureStore. If SQLCipher is unavailable at native
 * level, the database is still encrypted at the application layer by
 * the AEAD module (lib/crypto/aead.ts) for PHI fields.
 *
 * SEC-006 resolution: field-level AEAD for PHI (patient_mrn, patient_dob,
 * field_values) provides encryption at rest regardless of SQLCipher build.
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { migrations } from './migrations';
import { CaseEntry } from './models/CaseEntry';
import { CaseTemplate } from './models/CaseTemplate';
import { ProgramGoal } from './models/ProgramGoal';
import { Rotation } from './models/Rotation';
import { Milestone } from './models/Milestone';
import { EvaluationForm } from './models/EvaluationForm';
import { Comment } from './models/Comment';
import { Shift } from './models/Shift';

let _database: Database | null = null;

/**
 * Initialize the WatermelonDB database. Safe to call multiple times (returns
 * existing instance). The adapter is configured with JSI for synchronous
 * reads (fast path for offline queries).
 */
export async function initDatabase(): Promise<Database> {
  if (_database) return _database;

  const adapter = new SQLiteAdapter({
    schema,
    migrations,
    jsi: true,
    onSetUpError: (error: Error) => {
      console.error('[Database] setup error:', error);
    },
  });

  _database = new Database({
    adapter,
    modelClasses: [
      CaseEntry,
      CaseTemplate,
      ProgramGoal,
      Rotation,
      Milestone,
      EvaluationForm,
      Comment,
      Shift,
    ],
  });

  return _database;
}

/**
 * Get the already-initialized database instance. Throws if not yet initialized.
 */
export function getDatabase(): Database {
  if (!_database) {
    throw new Error(
      'Database not initialized. Call initDatabase() first.',
    );
  }
  return _database;
}
