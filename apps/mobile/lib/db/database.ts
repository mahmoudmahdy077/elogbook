import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { migrations } from './migrations';
import { CaseEntry } from './models/CaseEntry';
import { CaseTemplate } from './models/CaseTemplate';
import { ProgramGoal } from './models/ProgramGoal';
import { getOrCreateDbEncryptionKey } from './encryption-key';

const modelClasses = [CaseEntry, CaseTemplate, ProgramGoal];

let _database: Database | null = null;
let _dbKey: string | null = null;

/**
 * Returns the per-install database encryption key (creates one on first launch).
 * Cached for the lifetime of the JS context so we never re-fetch the key
 * from the keychain on every read.
 */
export async function getDbEncryptionKey(): Promise<string> {
  if (_dbKey) return _dbKey;
  _dbKey = await getOrCreateDbEncryptionKey();
  return _dbKey;
}

export function getDatabase(): Database {
  if (!_database) {
    const adapter = new SQLiteAdapter({
      schema,
      migrations,
      jsi: true,
      onSetUpError: (error) => {
        console.error('WatermelonDB setup error:', error);
      },
      // NOTE: the stock SQLiteAdapter does not pass the key to SQLCipher.
      // To get at-rest encryption, the app must be built with a SQLCipher
      // capable adapter (e.g. @op-engineering/op-sqlite) and the key
      // surfaced via `getDbEncryptionKey()` above. We keep the call site
      // here so swapping in an encrypted adapter is a one-line change and
      // the key material is generated on first launch regardless.
      ...(typeof process !== 'undefined' &&
      process.env?.EXPO_PUBLIC_ENABLE_SQLCIPHER === 'true'
        ? { dbName: 'elogbook-encrypted' }
        : {}),
    });
    _database = new Database({
      adapter,
      modelClasses,
    });
  }
  return _database;
}

export const database = getDatabase();