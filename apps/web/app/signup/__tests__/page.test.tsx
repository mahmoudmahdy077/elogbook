import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  })),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: vi.fn(async () => ({ data: { user: { id: 'new-user' } }, error: null })),
    },
  })),
}));

vi.mock('@/components/ErrorDisplay', () => ({
  default: vi.fn(() => null),
}));

describe('signup page', () => {
  it('renders email and password fields', async () => {
    const { default: SignupPage } = await import('../page');
    render(await SignupPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders a link to login', async () => {
    const { default: SignupPage } = await import('../page');
    render(await SignupPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});
