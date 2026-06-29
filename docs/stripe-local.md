# Stripe local development workflow

Phase 6 / P6.8 — Stripe test mode isolation.

## Why mode isolation matters

A single Supabase project may have many tenants, each with their own
Stripe gateway config. A test tenant uses a Stripe test-mode key; a
production tenant uses a live-mode key. If the webhook handler does
not filter by mode, a test event delivered to a production tenant
could create a fake subscription, or a live event delivered to a
test tenant could leak real card data into the test database.

## The rule

The webhook handler enforces:

```text
event.livemode === (gateway_config.mode === 'live')
```

If they do not match, the event is logged and skipped (no processing,
no `stripe_events` row).

## Forwarding events locally

For each tenant you want to forward events for, run `stripe listen`
once per gateway config. The CLI gives you a unique webhook secret
per command, which you must paste into the tenant's gateway config:

```bash
# Test tenant
stripe listen --forward-to http://localhost:54321/functions/v1/payment-webhook

# Production tenant (use a separate API key!)
stripe listen --forward-to http://localhost:54321/functions/v1/payment-webhook
```

Both forwards will hit the same edge function. The mode check then
routes the events to the correct tenant based on each gateway config
in `secret_payment_gateway_config`.

## Triggering test events

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
stripe trigger invoice.paid
```

The first two are `livemode: false` and will only be processed by
gateway configs where `mode = 'test'`. Use the Stripe CLI's `--live`
flag to forward a live event in a sandbox:

```bash
stripe trigger --live checkout.session.completed
```

## Inspecting the audit trail

Every processed event is recorded in `stripe_events` with its mode
and livemode columns. Mismatches are visible in the function logs
(matching `Skipping Stripe event: mode mismatch`).

## References

- `payment-webhook` edge function: `supabase/functions/payment-webhook/index.ts`
- Migration 00046 (mode column on the gateway config view)
- Migration 00021 (stripe_events table)
- Migration 00057 (failure recording)
