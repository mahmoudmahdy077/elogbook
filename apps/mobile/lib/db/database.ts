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
let _dbKey: string | null = null;

export async function getDbEncryptionKey(): Promise<string> {
  if (_dbKey) return _dbKey;
  _dbKey = await getOrCreateDbEncryptionKey();
  return _dbKey;
}

export async function getDatabase(): Promise<Database> {
  if (_database) return _database;

  const dbKey = await getDbEncryptionKey();

  const adapter = new SQLiteAdapter({
    schema,
    migrations,
    jsi: true,
    dbName: 'elogbook-encrypted',
    encryptionKey: dbKey,
    onSetUpError: (error) => {
      console.error('WatermelonDB setup error:', error);
    },
  });

  _database = new Database({
    adapter,
    modelClasses,
  });

  return _database;
}

/** @deprecated Use the async getDatabase() instead */
export function getDatabaseSync(): Database {
  throw new Error('getDatabaseSync is not supported. Use getDatabase() instead.');
}
