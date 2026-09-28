import { describe, expect, it, vi } from 'vitest';
import { promotePendingProfileIfNeeded } from '../profile-promotion';

function makeClient(options: {
  user?: { id: string } | null;
  profile?: { status: string } | null;
  profileError?: unknown;
  promotion?: { data?: unknown; error?: unknown };
}) {
  const rpc = vi.fn(async () => options.promotion ?? { data: { success: true }, error: null });
  const single = vi.fn(async () => ({
    data: options.profile ?? null,
    error: options.profileError ?? null,
  }));
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.user === undefined ? { id: 'user-1' } : options.user },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single })),
      })),
    })),
    rpc,
  };
  return { client, rpc };
}

describe('promotePendingProfileIfNeeded', () => {
  it('continues without promotion when the profile is already active', async () => {
    const { client, rpc } = makeClient({ profile: { status: 'active' } });

    const result = await promotePendingProfileIfNeeded(client as never);

    expect(result).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('promotes a pending profile after MFA verification', async () => {
    const { client, rpc } = makeClient({
      profile: { status: 'pending' },
      promotion: { data: { success: true }, error: null },
    });

    const result = await promotePendingProfileIfNeeded(client as never);

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('promote_pending_profile');
  });

  it('returns an error when a pending profile promotion genuinely fails', async () => {
    const { client, rpc } = makeClient({
      profile: { status: 'pending' },
      promotion: { data: { success: false }, error: null },
    });

    const result = await promotePendingProfileIfNeeded(client as never);

    expect(result).toEqual({
      ok: false,
      error: 'MFA verified, but account promotion failed. Please retry.',
    });
    expect(rpc).toHaveBeenCalledWith('promote_pending_profile');
  });

  it('does not call promotion when profile state cannot be verified', async () => {
    const { client, rpc } = makeClient({ profile: null, profileError: new Error('unavailable') });

    const result = await promotePendingProfileIfNeeded(client as never);

    expect(result).toEqual({ ok: false, error: 'Unable to verify account state. Please try again.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
