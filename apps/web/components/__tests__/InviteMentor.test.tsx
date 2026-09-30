import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  fetch: vi.fn(),
  from: vi.fn(),
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

function renderMentor() {
  return import('../InviteMentor').then((mod) =>
    render(<mod.default tenantSlug="tenant-a" tenantId="tenant-id" />),
  );
}

describe('InviteMentor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(jsonResponse(201, { success: true }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    cleanup();
  });

  it('never writes to tenant_invites directly from the browser', async () => {
    await renderMentor();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'invitee@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled();
    });
    expect(mocks.from).not.toHaveBeenCalled();
  }, 30000);

  it('creates the invitation through the audited admin endpoint', async () => {
    await renderMentor();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'invitee@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/tenant-a/admin/invite',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'invitee@example.test',
      role: 'resident',
    });
  }, 30000);

  it('never shows or fabricates an invitation link', async () => {
    await renderMentor();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'invitee@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => {
      expect(screen.getByText(/single-use link that expires/i)).toBeInTheDocument();
    });
    expect(document.body.innerHTML).not.toContain('invitation=');
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/email/i), 'success');
  }, 30000);

  it('offers no self-service registration link', async () => {
    await renderMentor();

    expect(screen.queryByRole('button', { name: /registration link/i })).not.toBeInTheDocument();
  }, 30000);

  it('reports a failure without claiming success', async () => {
    mocks.fetch.mockResolvedValue(jsonResponse(502, { error: 'The invitation could not be emailed. Please try again.' }));

    await renderMentor();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'invitee@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not be emailed/i)).toBeInTheDocument();
    });
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/successfully/i), 'success');
  }, 30000);
});
