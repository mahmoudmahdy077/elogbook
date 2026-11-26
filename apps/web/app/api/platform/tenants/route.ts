import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * POST /api/platform/tenants
 *
 * Creates an empty tenant. Before this route the platform console was
 * read-only and the setup wizard is 404 in production, so there was no way to
 * provision a hospital at all. The first administrator is invited from
 * /[tenant]/invites (as supervisor, then promoted after MFA enrolment —
 * trg_enforce_mfa blocks director+ profiles without a verified factor).
 */
export async function POST(request: Request) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  let body: { name?: string; slug?: string; tenant_type?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = (body.name ?? '').trim().slice(0, 120);
  const slug = (body.slug ?? '').trim().toLowerCase().slice(0, 60);
  const tenantType = body.tenant_type === 'individual' ? 'individual' : 'institution';

  if (name.length < 2) {
    return NextResponse.json({ error: 'Name must be at least 2 characters.' }, { status: 400 });
  }
  if (!SLUG_RE.test(slug) || slug.length < 2) {
    return NextResponse.json(
      { error: 'Slug must be lowercase letters, numbers and single hyphens.' },
      { status: 400 },
    );
  }
  if (slug === 'global-community' || slug === 'platform' || slug === 'api') {
    return NextResponse.json({ error: 'That slug is reserved.' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: existing } = await admin.from('tenants').select('id').eq('slug', slug).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'That slug is already taken.' }, { status: 409 });
  }

  const { data: tenant, error } = await admin
    .from('tenants')
    .insert({
      name,
      slug,
      tenant_type: tenantType,
      mrn_hash_salt: randomBytes(32).toString('hex'),
      settings: {},
      status: 'active',
    })
    .select('id, name, slug, tenant_type')
    .single();

  if (error || !tenant) {
    return NextResponse.json({ error: error?.message ?? 'Could not create the tenant.' }, { status: 500 });
  }

  await admin.from('audit_logs').insert({
    tenant_id: tenant.id,
    user_id: platform.user.id,
    action: 'create_tenant',
    resource_type: 'tenants',
    resource_id: tenant.id,
    changes: { name, slug, tenant_type: tenantType },
  });

  return NextResponse.json({ success: true, tenant });
}
