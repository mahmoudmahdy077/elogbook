import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getLastSyncTimestamp(): Promise<number | null> {
  const val = await AsyncStorage.getItem('last_sync_timestamp');
  return val ? parseInt(val, 10) : null;
}

export async function setLastSyncTimestamp(ts: number): Promise<void> {
  await AsyncStorage.setItem('last_sync_timestamp', ts.toString());
}

export async function getPreference(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function setPreference(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}
