# API Contract: SaaS Billing

**Feature**: Premium Mobile Logbook | **Endpoints**: `supabase/functions/create-checkout`, `supabase/functions/payment-webhook`

## Overview

SaaS billing supports two customer types: individual residents (in-app purchase or Stripe Checkout) and institutions (Stripe Checkout with seat-based pricing). Existing infrastructure is extended with subscription lifecycle management and institution billing records.

## Subscription Plans (Existing — Unchanged)

| Plan | Slug | Price/Mo | Tenant Type | Max Residents | Features |
|------|------|----------|-------------|---------------|----------|
| Free | `free` | $0 | individual | — | 20 cases max |
| Individual Premium | `individual-premium` | $9.99 | individual | — | AI, PDF export, goal tracking |
| Institution Basic | `institution-basic` | $49.99 | institution | 10 | PDF export, approval workflow |
| Institution Pro | `institution-pro` | $149.99 | institution | 50 | AI, PDF export, approval, goals, audit |
| Institution Enterprise | `institution-enterprise` | Custom | institution | Unlimited | All features + SSO |

## Create Checkout Session

### HTTP POST

```
POST /functions/v1/create-checkout
Authorization: Bearer {user_jwt}
Content-Type: application/json
```

### Body

```json
{
  "tenant_id": "uuid (required)",
  "plan_id": "uuid (required)",
  "gateway": "stripe (required — currently only Stripe implemented)",
  "success_url": "string (optional — redirect after payment)",
  "cancel_url": "string (optional — redirect on cancel)",
  "quantity": "number (optional — seat count for institutions, defaults to 1)"
}
```

### Response (200)

```json
{
  "sessionId": "string — Stripe Checkout session ID",
  "url": "string — Stripe Checkout URL (redirect user here)"
}
```

### Error Responses

| Status | Body | When |
|--------|------|------|
| `400` | `{"error": "plan_id required"}` | Missing field |
| `404` | `{"error": "Plan not found"}` | Invalid plan_id |
| `404` | `{"error": "Payment gateway not configured"}` | No active `payment_gateway_config` |
| `501` | `{"error": "Gateway {gateway} not yet implemented"}` | Non-Stripe gateway |

## Payment Webhook

### HTTP POST (Stripe → Supabase)

```
POST /functions/v1/payment-webhook
Content-Type: application/json
Stripe-Signature: {whsec_signature}
```

### Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Upsert `subscriptions` with status `active`, store `gateway_subscription_id` |
| `customer.subscription.deleted` | Set subscription status to `canceled` |
| `invoice.paid` | Update `current_period_start`/`current_period_end`, set status `active` |

### Institution Billing

When a `checkout.session.completed` event is for an institution tenant:

1. Create/update `subscriptions` record
2. Create `institution_billing` record for the current billing period:
   ```json
   {
     "tenant_id": "uuid",
     "billing_period_start": "date",
     "billing_period_end": "date (start + 30 days)",
     "active_residents": "number (from profiles count)",
     "base_amount": "number (plan price_monthly)",
     "per_resident_fee": "number (plan price_monthly * seat_count calculation)",
     "total_amount": "number (base + per_resident)",
     "status": "paid"
   }
   ```

## Subscription Status Transition Rules

```
active → past_due (payment failed)
past_due → active (payment recovered)
past_due → canceled (grace period expired)
active → canceled (user cancellation)
canceled → active (new subscription — creates new row)
trialing → active (trial ended, payment successful)
trialing → canceled (trial ended, no payment)
```

### Grace Period Behavior

When subscription enters `past_due`:
- **Individual**: Features continue for 7 days with prominent "Update Payment" banner
- **Institution**: Features continue for 14 days with admin notification; after 14 days, switches to read-only mode (residents can view, cannot log new cases)
- **After 30 days past_due**: Subscription set to `canceled`, features revert to Free tier

## Client Integration

### Web - SubscriptionPlans Component

Existing `apps/web/components/SubscriptionPlans.tsx` handles plan display and checkout. Enhancements:
- Plan comparison cards with feature checkmarks/crosses (FR-019)
- "Current Plan" highlight with glowing teal border
- Seat count selector for institution plans
- Upgrade/downgrade confirmation flow

### Mobile - In-App Purchase

Individual residents can subscribe via:
1. Stripe Checkout (web-based, opened in browser)
2. In-app purchase flow (iOS/Android — future enhancement)

Current implementation uses `create-checkout` edge function with redirect to Stripe.
