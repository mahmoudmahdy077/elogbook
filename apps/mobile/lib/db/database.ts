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
import { getOrCreateDbEncryptionKey } from './encryption-key';

const modelClasses = [CaseEntry, CaseTemplate, ProgramGoal, Rotation, Milestone, EvaluationForm, Comment, Shift];

let _database: Database | null = null;
let _initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (_database) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const dbKey = await getOrCreateDbEncryptionKey();

    const adapter = new SQLiteAdapter({
      schema,
      migrations,
      jsi: true,
      dbName: 'elogbook-encrypted',
      encryptionKey: dbKey,
      onSetUpError: (err: unknown) => {
        console.error('WatermelonDB setup error:', err);
      },
    } as any);

    _database = new Database({
      adapter,
      modelClasses,
    });
  })();

  return _initPromise;
}

export function getDatabase(): Database {
  if (!_database) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _database;
}

export async function initDatabase(): Promise<Database> {
  await ensureInit();
  return _database!;
}
