/**
 * Who may change a tenant's subscription plan directly.
 *
 * The admin PUT used to accept any `plan_id` and set `status: 'active'`, so an
 * institution admin could move their tenant to the most expensive plan without
 * paying. Paid changes belong to the checkout flow: `create-checkout` starts a
 * Stripe session and `payment-webhook` writes the subscription on
 * `checkout.session.completed`. This policy keeps the direct path for the two
 * cases that need no payment:
 *
 *  - a platform operator granting/comping a plan;
 *  - a self-service downgrade to a free plan (or a no-op re-select).
 *
 * Everything else must return 402 so the UI can start checkout.
 */

export interface PlanChangeInput {
  callerRole: string;
  currentPlanId: string | null;
  targetPlanId: string;
  targetPriceMonthly: number | string | null;
}

export type PlanChangeDecision =
  | { allowed: true }
  | { allowed: false; status: 402; error: string };

export function decidePlanChange(input: PlanChangeInput): PlanChangeDecision {
  if (input.callerRole === 'admin') return { allowed: true };
  if (input.currentPlanId === input.targetPlanId) return { allowed: true };

  const price = Number(input.targetPriceMonthly ?? 0);
  if (Number.isFinite(price) && price <= 0) return { allowed: true };

  return {
    allowed: false,
    status: 402,
    error:
      'Paid plan changes must be completed through checkout. Start the upgrade from Billing so payment is recorded before the plan changes.',
  };
}
