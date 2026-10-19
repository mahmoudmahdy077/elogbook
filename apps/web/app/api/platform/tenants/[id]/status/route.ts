import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';

const tenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'archived']),
  reason: z.string().max(1000).optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const runtime = 'nodejs';

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
  const guarded = await guardRequest(request, tenantStatusSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { id } = await params;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  const { status, reason, expectedUpdatedAt } = guarded.data;

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
