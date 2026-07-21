import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({ data: [
          { id: '1', name: 'Free', slug: 'free', price_monthly: 0, features: { max_cases: 20 }, tenant_type: 'individual', max_residents: null },
          { id: '2', name: 'Individual Premium', slug: 'individual-premium', price_monthly: 9.99, features: { ai: true }, tenant_type: 'individual', max_residents: null },
          { id: '3', name: 'Institution Basic', slug: 'institution-basic', price_monthly: 49.99, features: { max_residents: 10 }, tenant_type: 'institution', max_residents: 10 },
          { id: '4', name: 'Institution Pro', slug: 'institution-pro', price_monthly: 149.99, features: { max_residents: 50, ai: true }, tenant_type: 'institution', max_residents: 50 },
          { id: '5', name: 'Enterprise', slug: 'enterprise', price_monthly: 0, features: { custom: true }, tenant_type: 'institution', max_residents: null },
        ] }))
      }))
    }))
  }))
}));

describe('pricing page — UXW-001', () => {
  it('renders 5 plan cards', async () => {
    const { default: PricingPage } = await import('../page');
    render(await PricingPage());
    expect(screen.getAllByTestId('plan-card')).toHaveLength(5);
  });

  it('renders a Sign-up link on each paid plan', async () => {
    const { default: PricingPage } = await import('../page');
    render(await PricingPage());
    const signupLinks = screen.getAllByRole('link', { name: /sign up/i });
    expect(signupLinks.length).toBeGreaterThan(0);
  });
});
