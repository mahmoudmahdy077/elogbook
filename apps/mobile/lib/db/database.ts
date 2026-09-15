/**
 * WatermelonDB database initialization.
 *
 * Storage claim (precise, see ADR-002): this adapter is a NORMAL
 * SQLiteAdapter with NO native key / SQLCipher option wired. Database
 * encryption at rest is NOT provided by this module. PHI confidentiality
 * at rest comes ONLY from field-level AEAD envelopes (lib/crypto/aead.ts
 * via data-access.ts sealPhi and lib/security/phi-encryption.ts) keyed by
 * the SecureStore device key. Do not claim otherwise without a signed
 * artifact inspection (ledger P1-sqlcipher-boundary).
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { logError } from '../logger';
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
      logError('database.setup', error);
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
