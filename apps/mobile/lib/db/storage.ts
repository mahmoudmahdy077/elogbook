import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_PREFIX = 'draft_case_';

export async function saveDraftCase(data: Record<string, unknown>): Promise<string> {
  const key = `${DRAFT_PREFIX}${Date.now()}`;
  await AsyncStorage.setItem(key, JSON.stringify({ ...data, sync_status: 'pending' }));
  return key;
}

export async function getDraftCases(): Promise<Array<Record<string, unknown> & { _key: string }>> {
  const keys = await AsyncStorage.getAllKeys();
  const draftKeys = keys.filter((k) => k.startsWith(DRAFT_PREFIX));
  const result = await AsyncStorage.getMany(draftKeys);
  return draftKeys
    .map((key) => {
      const value = result[key];
      return value ? { _key: key, ...JSON.parse(value) } : null;
    })
    .filter(Boolean) as Array<Record<string, unknown> & { _key: string }>;
}

export async function removeDraftCase(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

export async function clearAllDrafts(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const draftKeys = keys.filter((k) => k.startsWith(DRAFT_PREFIX));
  await Promise.all(draftKeys.map((k) => AsyncStorage.removeItem(k)));
}
