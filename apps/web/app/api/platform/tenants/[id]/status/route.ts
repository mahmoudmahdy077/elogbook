import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const LIFECYCLE_STATUSES = ['active', 'suspended', 'archived'] as const;

/**
 * Platform tenant lifecycle (T18). Suspend/reactivate/archive with audit
 * and optimistic concurrency (expectedUpdatedAt mismatch → 409).
 * Suspension takes effect in guarded routes immediately; row-level
 * enforcement across direct REST/RPC/Storage is T18-full work predicated
 * on the status column this ticket's migration adds.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  let body: { status?: string; reason?: string; expectedUpdatedAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { status, reason, expectedUpdatedAt } = body;

  if (!status || !(LIFECYCLE_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${LIFECYCLE_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const adminClient = createServiceRoleClient();
  const { data: tenant } = await adminClient
    .from('tenants')
    .select('id, slug, status, updated_at')
    .eq('id', id)
    .single();

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  if (
    expectedUpdatedAt !== undefined &&
    (tenant as { updated_at?: string }).updated_at !== expectedUpdatedAt
  ) {
    return NextResponse.json(
      { error: 'Tenant changed since you loaded it; reload and retry' },
      { status: 409 },
    );
  }

  const { data: updated, error: updateError } = await adminClient
    .from('tenants')
    .update({
      status,
      status_changed_at: new Date().toISOString(),
      status_reason: reason ?? null,
    })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    tenant_id: id,
    user_id: platform.user.id,
    action: 'tenant_status_change',
    resource_type: 'tenants',
    resource_id: id,
    changes: {
      from: (tenant as { status?: string }).status ?? null,
      to: status,
      reason: reason ?? null,
    },
  });

  const row = (Array.isArray(updated) ? updated[0] : updated) as { status?: string } | null;
  return NextResponse.json({ success: true, status: row?.status ?? status });
}
