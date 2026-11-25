import { describe, it, expect } from 'vitest';
import { decidePlanChange } from '../plan-change-policy';

describe('decidePlanChange', () => {
  const base = {
    callerRole: 'institution_admin',
    currentPlanId: 'plan-basic',
    targetPlanId: 'plan-enterprise',
    targetPriceMonthly: 499,
  };

  it('blocks a paid upgrade by a tenant admin', () => {
    const d = decidePlanChange(base);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.status).toBe(402);
  });

  it('allows a platform operator to grant any plan', () => {
    expect(decidePlanChange({ ...base, callerRole: 'admin' }).allowed).toBe(true);
  });

  it('allows re-selecting the current plan', () => {
    expect(decidePlanChange({ ...base, targetPlanId: 'plan-basic' }).allowed).toBe(true);
  });

  it('allows a downgrade to a free plan', () => {
    expect(decidePlanChange({ ...base, targetPlanId: 'plan-free', targetPriceMonthly: 0 }).allowed).toBe(true);
  });

  it('treats a numeric string price like a number', () => {
    expect(decidePlanChange({ ...base, targetPriceMonthly: '0.00' }).allowed).toBe(true);
    expect(decidePlanChange({ ...base, targetPriceMonthly: '49.00' }).allowed).toBe(false);
  });

  it('fails closed on an unparseable price', () => {
    expect(decidePlanChange({ ...base, targetPriceMonthly: 'n/a' }).allowed).toBe(false);
  });
});
