import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// RLS on subscription_plans only admitted `authenticated` readers, so the
// anonymous /pricing read returned zero rows and the page shipped an empty
// grid. The page must still list the standard plans in that case.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(async () => ({ data: [], error: null })),
      })),
    })),
  })),
}));

describe('pricing page — empty read falls back to list prices', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the fallback plans instead of an empty grid', { timeout: 10000 }, async () => {
    const { default: PricingPage } = await import('../page');
    render(await PricingPage());
    expect(screen.getAllByTestId('plan-card').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByTestId('pricing-fallback-note')).toBeTruthy();
  });

  it('sends the enterprise tier to sales rather than a self-serve signup', { timeout: 10000 }, async () => {
    const { default: PricingPage } = await import('../page');
    render(await PricingPage());
    expect(screen.getAllByRole('link', { name: /contact sales/i }).length).toBeGreaterThan(0);
  });
});
