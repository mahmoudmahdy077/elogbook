import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: { signUp: mocks.signUp },
  })),
}));

vi.mock('@/components/ErrorDisplay', () => ({
  default: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));

async function renderSignup(searchParams: Record<string, string | undefined> = {}) {
  const { default: SignupPage } = await import('../page');
  return render(await SignupPage({ searchParams: Promise.resolve(searchParams) }));
}

function submitWithEmail(email: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

describe('signup page', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(jsonResponse(201, { success: true }));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('asks for an invitation code instead of offering open password signup', async () => {
    await renderSignup();

    expect(screen.getByLabelText(/invitation code/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  }, 30000);

  it('renders a link to login', async () => {
    await renderSignup();

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  }, 30000);

  it('prefills the invitation code from the emailed link', async () => {
    await renderSignup({ invitation: 'abc123' });

    expect(screen.getByLabelText(/invitation code/i)).toHaveValue('abc123');
  }, 30000);

  it('never calls supabase.auth.signUp', async () => {
    await renderSignup({ invitation: 'abc123' });
    submitWithEmail('invitee@example.test');

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled();
    });
    expect(mocks.signUp).not.toHaveBeenCalled();
  }, 30000);

  it('posts the invitation and email to the redemption endpoint', async () => {
    await renderSignup({ invitation: 'abc123' });
    submitWithEmail('invitee@example.test');

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/invitations/accept',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const [, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      token: 'abc123',
      email: 'invitee@example.test',
    });
  }, 30000);

  it('explains an expired invitation without asking for a password', async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse(410, { error: 'This invitation has expired. Ask your administrator for a new one.' }),
    );

    await renderSignup({ invitation: 'abc123' });
    submitWithEmail('invitee@example.test');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/expired/i);
    });
    expect(mocks.signUp).not.toHaveBeenCalled();
  }, 30000);
});
