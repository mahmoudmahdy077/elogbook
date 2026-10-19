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
let _resetFailure: Error | null = null;

export const PLAINTEXT_DATABASE_PRODUCTION_ERROR =
  '[database] plaintext SQLite is disabled in production until a verified encrypted adapter is configured';

export function isProductionRuntime(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

export function isPlaintextDatabasePathEnabled(): boolean {
  return !isProductionRuntime();
}

export function assertLocalClinicalStorageAllowed(): void {
  if (isProductionRuntime()) throw new Error(PLAINTEXT_DATABASE_PRODUCTION_ERROR);
}

export async function initDatabase(): Promise<Database> {
  assertLocalClinicalStorageAllowed();
  if (_resetFailure) throw _resetFailure;
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

export async function resetDatabase(): Promise<void> {
  let database = _database;
  if (!database) {
    if (isProductionRuntime()) return;
    await initDatabase();
    database = _database;
  }
  if (!database) return;
  try {
    await database.write(() => database.unsafeResetDatabase());
    _database = null;
    _resetFailure = null;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    _database = null;
    _resetFailure = failure;
    logError('database.reset', failure);
    throw failure;
  }
}

export function getDatabase(): Database {
  assertLocalClinicalStorageAllowed();
  if (_resetFailure) throw _resetFailure;
  if (!_database) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _database;
}
