import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPushNotification } from '../notifications';
import { createServiceRoleClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

const updateMock = vi.fn();

beforeEach(() => {
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({
            data: table === 'push_tokens' ? [{ token: 'ExponentPushToken[abc]' }] : null,
            error: null,
          }),
        }),
      }),
      update: () => ({ in: updateMock }),
    }),
  } as never);
  updateMock.mockResolvedValue({ error: null });
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok', to: 'ExponentPushToken[abc]' }] }), { status: 200 }));
});

describe('sendPushNotification', () => {
  it('POSTs to the Expo push API with the stored token', async () => {
    await sendPushNotification('user-1', { title: 't', body: 'b', data: { type: 'case.approved', caseId: 'c1' } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
