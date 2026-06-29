import { describe, it, expect } from 'vitest';
import { createMockSupabaseClient, resetMockData, setTableData } from '../lib/__tests__/helpers/supabase-mock';

describe('Mobile test scaffold', () => {
  it('mock Supabase client can read/write tables', async () => {
    resetMockData();
    setTableData('case_entries', [
      { id: 'c-1', status: 'draft', tenant_id: 't-1' },
      { id: 'c-2', status: 'pending', tenant_id: 't-1' },
    ]);
    const client = createMockSupabaseClient();
    const res = await client.from('case_entries').select('*').eq('status', 'draft');
    expect(res.data).toEqual([{ id: 'c-1', status: 'draft', tenant_id: 't-1' }]);
  });

  it('mock auth client reports a session', async () => {
    const client = createMockSupabaseClient();
    const res = await client.auth.getSession();
    expect(res.error).toBeNull();
    expect(res.data.session.access_token).toBe('jwt');
  });
});
