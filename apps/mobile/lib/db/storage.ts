/**
 * DORMANT — do not use for new code (R3).
 *
 * No production callers (legacy helpers superseded by scoped stores in
 * draft-store.ts, durable-queue.ts, and account-context.scopedKey()).
 * The generic getPreference/setPreference pair is unscoped by construction
 * and must never hold identity or PHI. Kept pending the one-release removal
 * window with upgrade evidence.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scopedKey } from '../account-context';

const SYNC_TIMESTAMP_KEY = 'last_sync_timestamp';

export async function getLastSyncTimestamp(): Promise<number | null> {
  const val = await AsyncStorage.getItem(scopedKey(SYNC_TIMESTAMP_KEY));
  return val ? parseInt(val, 10) : null;
}

export async function setLastSyncTimestamp(ts: number): Promise<void> {
  await AsyncStorage.setItem(scopedKey(SYNC_TIMESTAMP_KEY), ts.toString());
}

export async function getPreference(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function setPreference(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}
