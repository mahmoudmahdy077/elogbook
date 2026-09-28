import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  fetch: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: mocks.from,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-user' } } })) },
  })),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ show: mocks.showToast }),
}));

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

const USERS = [
  {
    id: 'profile-1',
    user_id: 'auth-1',
    full_name: 'Resident One',
    role: 'resident',
    specialty: null,
    tenant_id: 'tenant-id',
  },
  {
    id: 'profile-2',
    user_id: 'auth-2',
    full_name: 'Resident Two',
    role: 'supervisor',
    specialty: null,
    tenant_id: 'tenant-id',
  },
];

async function renderManager() {
  const mod = await import('../UserManager');
  return render(
    <mod.default tenantId="tenant-id" tenantSlug="tenant-a" users={USERS} currentUserRole="admin" />,
  );
}

describe('UserManager role and status changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(async () => ({ data: [] }));
    chain.update = mocks.update;
    mocks.from.mockReturnValue(chain);
    mocks.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    cleanup();
  });

  it('never writes the profiles table directly', async () => {
    await renderManager();
    fireEvent.click(screen.getAllByRole('button', { name: /edit role/i })[0]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'director' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled();
    });
    expect(mocks.update).not.toHaveBeenCalled();
  }, 30000);

  it('routes a role change through the AAL2 profile endpoint', async () => {
    await renderManager();
    fireEvent.click(screen.getAllByRole('button', { name: /edit role/i })[0]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'director' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/tenant-a/admin/users/profile-1',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ role: 'director' });
  }, 30000);

  it('routes a deactivation through the status action endpoint', async () => {
    await renderManager();
    fireEvent.click(screen.getAllByRole('button', { name: /^deactivate$/i })[0]);

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/tenant-a/admin/users/profile-1/action',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ action: 'deactivate' });
  }, 30000);

  it('surfaces the last-administrator refusal instead of reporting success', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse(409, { error: 'Cannot remove the last institution admin of this tenant' }),
    );

    await renderManager();
    fireEvent.click(screen.getAllByRole('button', { name: /edit role/i })[0]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'resident' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Cannot remove the last institution admin of this tenant',
        'error',
      );
    });
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/successfully/i), 'success');
  }, 30000);

  it('never reports success when the request fails', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse(403, { error: 'Insufficient permissions' }));

    await renderManager();
    fireEvent.click(screen.getAllByRole('button', { name: /^deactivate$/i })[0]);

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('Insufficient permissions', 'error');
    });
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/deactivated/i), 'success');
  }, 30000);
});
