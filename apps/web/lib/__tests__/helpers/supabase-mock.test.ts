import { describe, it, expect } from 'vitest';
import { createMockSupabaseClient, setTableData, resetMockData } from './supabase-mock';

describe('supabase-mock', () => {
  beforeEach(() => resetMockData());

  it('selects rows from a table', async () => {
    setTableData('case_entries', [
      { id: '1', status: 'draft' },
      { id: '2', status: 'pending' },
    ]);
    const client = createMockSupabaseClient();
    const { data } = await client.from('case_entries').select('*').eq('status', 'draft');
    expect(data).toEqual([{ id: '1', status: 'draft' }]);
  });

  it('inserts rows', async () => {
    const client = createMockSupabaseClient();
    await client.from('case_entries').insert([{ id: '1', status: 'draft' }]);
    const { data } = await client.from('case_entries').select('*');
    expect(data).toEqual([{ id: '1', status: 'draft' }]);
  });

  it('returns single row', async () => {
    setTableData('profiles', [{ id: 'p-1', role: 'resident' }]);
    const client = createMockSupabaseClient();
    const { data } = await client.from('profiles').select('*').eq('id', 'p-1').single();
    expect(data).toEqual({ id: 'p-1', role: 'resident' });
  });

  it('exposes a mocked auth.getUser', async () => {
    const client = createMockSupabaseClient();
    const { data, error } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user.id).toBe('u-1');
  });
});
