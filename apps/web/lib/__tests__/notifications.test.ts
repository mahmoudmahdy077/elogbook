import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseHolder } = vi.hoisted(() => ({
  supabaseHolder: { current: null as unknown },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => supabaseHolder.current,
}));

import {
  APPROVED_PUSH_COPY,
  isPushVendorPolicyApproved,
  notifyCaseApproval,
  notifyPendingApproval,
  sendPushNotification,
} from '../notifications';

const TOKEN = 'ExponentPushToken[abc]';

function chain(result: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update', 'in']) self[m] = () => self;
  self.maybeSingle = () => Promise.resolve(result);
  self.then = (resolve: (v: unknown) => void) => resolve(result);
  return self;
}

function useSupabase(options: { tokens?: unknown[]; noTokens?: boolean } = {}) {
  supabaseHolder.current = {
    from: (table: string) => {
      if (table === 'profiles') return chain({ data: { user_id: 'auth-1' }, error: null });
      if (table === 'push_tokens') {
        return options.noTokens
          ? chain({ data: [], error: null })
          : chain({ data: (options.tokens ?? [{ token: TOKEN }]), error: null });
      }
      return chain({ data: null, error: null });
    },
  };
}

describe('isPushVendorPolicyApproved', () => {
  it('approves only the metadata-only policy', () => {
    expect(isPushVendorPolicyApproved('metadata_only')).toBe(true);
    expect(isPushVendorPolicyApproved('phi')).toBe(false);
    expect(isPushVendorPolicyApproved(undefined)).toBe(false);
  });
});

describe('sendPushNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUSH_VENDOR_POLICY', 'metadata_only');
    useSupabase();
    globalThis.fetch = vi.fn().mockResolvedValue({ json: async () => ({ data: [] }) });
  });

  it('does not send when the vendor policy is not approved', async () => {
    vi.stubEnv('PUSH_VENDOR_POLICY', '');
    useSupabase();

    await sendPushNotification('profile-1', {
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not send when the vendor policy is unset', async () => {
    vi.stubEnv('PUSH_VENDOR_POLICY', undefined);
    useSupabase();

    await sendPushNotification('profile-1', {
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends approved generic copy with opaque ids', async () => {
    await sendPushNotification('profile-1', {
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
      data: { type: 'case.approved', caseId: 'entry-1', status: 'approved' },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(payload[0]).toMatchObject({
      to: TOKEN,
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
    });
    expect(payload[0].data).toEqual({ type: 'case.approved', caseId: 'entry-1', status: 'approved' });
  });

  it('refuses unapproved copy that names a person', async () => {
    await sendPushNotification('profile-1', {
      title: 'Case approved',
      body: 'Your case was approved by Dr Smith.',
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a data payload with a non-opaque value in an allowlisted key', async () => {
    await sendPushNotification('profile-1', {
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
      data: { type: 'case.approved', caseId: 'appendicitis on the night case' },
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drops an unknown data key but still sends the opaque remainder', async () => {
    await sendPushNotification('profile-1', {
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
      data: { type: 'case.approved', resident_name: 'Dr Jane Resident', caseId: 'entry-1' },
    });

    const payload = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(payload[0].data).toEqual({ type: 'case.approved', caseId: 'entry-1' });
    expect(JSON.stringify(payload)).not.toContain('Dr Jane');
  });

  it('is a no-op when the user has no push token', async () => {
    useSupabase({ noTokens: true });

    await sendPushNotification('profile-1', {
      title: APPROVED_PUSH_COPY.caseApproved.title,
      body: APPROVED_PUSH_COPY.caseApproved.body,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not throw when Expo is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(
      sendPushNotification('profile-1', {
        title: APPROVED_PUSH_COPY.caseApproved.title,
        body: APPROVED_PUSH_COPY.caseApproved.body,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('notifyCaseApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUSH_VENDOR_POLICY', 'metadata_only');
    useSupabase();
    globalThis.fetch = vi.fn().mockResolvedValue({ json: async () => ({ data: [] }) });
  });

  it('never includes the reviewer name', async () => {
    await notifyCaseApproval('entry-1', 'resident-1', 'approved');

    const payload = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/reviewer/i);
    expect(payload[0].body).toBe(APPROVED_PUSH_COPY.caseApproved.body);
    expect(payload[0].title).toBe(APPROVED_PUSH_COPY.caseApproved.title);
  });

  it('uses a distinct generic body for a rejection', async () => {
    await notifyCaseApproval('entry-1', 'resident-1', 'rejected');

    const payload = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(payload[0].body).toBe(APPROVED_PUSH_COPY.caseRejected.body);
    expect(payload[0].data).toEqual({ type: 'case.rejected', caseId: 'entry-1', status: 'rejected' });
  });
});

describe('notifyPendingApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PUSH_VENDOR_POLICY', 'metadata_only');
    useSupabase();
    globalThis.fetch = vi.fn().mockResolvedValue({ json: async () => ({ data: [] }) });
  });

  it('never includes the resident name', async () => {
    await notifyPendingApproval('entry-1', 'supervisor-1');

    const payload = JSON.parse((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string);
    expect(payload[0].body).toBe(APPROVED_PUSH_COPY.pendingApproval.body);
    expect(JSON.stringify(payload)).not.toContain('submitted a case');
  });
});
