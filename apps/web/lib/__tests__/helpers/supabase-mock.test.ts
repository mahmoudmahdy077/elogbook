import { describe, it, expect, beforeEach } from 'vitest';
import { createMockSupabaseClient, setTableData, resetMockData } from './supabase-mock';

describe('supabase-mock', () => {
  beforeEach(() => resetMockData());

  it('selects rows from a table', async () => {
    setTableData('case_entries', [
      { id: '1', status: 'draft' },
      { id: '2', status: 'pending' },
    ]);
    const client = createMockSupabaseClient();
    const res = (await client.from('case_entries').select('*').eq('status', 'draft')) as { data: unknown; error: null };
    expect(res.data).toEqual([{ id: '1', status: 'draft' }]);
  });

  it('inserts rows', async () => {
    const client = createMockSupabaseClient();
    await client.from('case_entries').insert([{ id: '1', status: 'draft' }]);
    const res = (await client.from('case_entries').select('*')) as { data: unknown; error: null };
    expect(res.data).toEqual([{ id: '1', status: 'draft' }]);
  });

  it('applies conditional updates only to matched rows and returns them', async () => {
    setTableData('case_entries', [
      { id: '1', status: 'draft' },
      { id: '2', status: 'pending' },
    ]);
    const client = createMockSupabaseClient();
    const res = (await client
      .from('case_entries')
      .update({ status: 'archived' })
      .eq('status', 'draft')
      .select('id')) as { data: unknown[]; error: null };
    expect(res.data).toEqual([{ id: '1', status: 'archived' }]);
    const after = (await client.from('case_entries').select('*')) as { data: unknown[] };
    expect(after.data).toEqual([
      { id: '1', status: 'archived' },
      { id: '2', status: 'pending' },
    ]);
  });

  it('returns empty data when a conditional update matches nothing', async () => {
    setTableData('case_entries', [{ id: '1', status: 'pending' }]);
    const client = createMockSupabaseClient();
    const res = (await client
      .from('case_entries')
      .update({ status: 'archived' })
      .eq('id', '1')
      .eq('status', 'draft')
      .select('id')) as { data: unknown[]; error: null };
    expect(res.data).toEqual([]);
  });

  it('returns single row', async () => {
    setTableData('profiles', [{ id: 'p-1', role: 'resident' }]);
    const client = createMockSupabaseClient();
    const res = (await client.from('profiles').select('*').eq('id', 'p-1').single()) as { data: unknown; error: null };
    expect(res.data).toEqual({ id: 'p-1', role: 'resident' });
  });

  it('exposes a mocked auth.getUser', async () => {
    const client = createMockSupabaseClient();
    const res = (await client.auth.getUser()) as { data: { user: { id: string } }; error: null };
    expect(res.error).toBeNull();
    expect(res.data.user.id).toBe('u-1');
  });
});
