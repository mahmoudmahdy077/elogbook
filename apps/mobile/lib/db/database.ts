import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { CaseEntry } from './models/CaseEntry';
import { CaseTemplate } from './models/CaseTemplate';
import { ProgramGoal } from './models/ProgramGoal';

const modelClasses = [CaseEntry, CaseTemplate, ProgramGoal];

let _database: Database | null = null;

export function getDatabase(): Database {
  if (!_database) {
    const adapter = new SQLiteAdapter({
      schema,
      jsi: true,
      onSetUpError: (error) => {
        console.error('WatermelonDB setup error:', error);
      },
    });
    _database = new Database({
      adapter,
      modelClasses,
    });
  }
  return _database;
}

export const database = getDatabase();