import { NextResponse } from 'next/server';

// Cancellation is a provider-mediated state change: Stripe's
// `customer.subscription.deleted` event is what moves the row to `canceled`, and
// the tenant can trigger that from the billing portal.
//
// A direct tenant-side UPDATE of `subscriptions` is not available. It would be
// a second, unauthenticated-by-payment way to change entitlement state, and it
// would let a tenant desynchronize local status from the provider's — the
// subscription would read as canceled while Stripe kept billing.
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Cancel in the billing portal. The subscription is updated when Stripe confirms the cancellation.',
      code: 'cancellation_requires_payment_event',
      portal: '/billing',
    },
    { status: 409 },
  );
}
