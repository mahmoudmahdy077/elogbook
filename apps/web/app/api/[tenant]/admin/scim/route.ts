import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf-8').digest('hex');
}

function generateToken(): string {
  return 'scim_' + crypto.randomBytes(32).toString('hex');
}

// Fields we expose in API responses (never the plain token_hash)
const TOKEN_LIST_FIELDS =
  'id, tenant_id, description, created_by, created_at, last_used_at, revoked_at';

// ---------------------------------------------------------------------------
// Permission gate used by all handlers
// ---------------------------------------------------------------------------
async function authorize(
  slug: string,
  allowInstitutionAdmin = true,
): Promise<
  | { profile: { id: string; tenant_id: string; role: string }; error: null }
  | { profile: null; error: NextResponse }
> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { profile: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return { profile: null, error: NextResponse.json({ error: 'Profile not found' }, { status: 404 }) };
  }

  const tenant = (profile.tenants as { slug: string }[])[0];
  if (tenant.slug !== slug) {
    return { profile: null, error: NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 }) };
  }

  const allowed = allowInstitutionAdmin
    ? ['director', 'institution_admin', 'admin']
    : ['institution_admin', 'admin'];

  if (!allowed.includes(profile.role)) {
    return { profile: null, error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) };
  }

  return { profile: { id: profile.id, tenant_id: profile.tenant_id, role: profile.role }, error: null };
}

// ---------------------------------------------------------------------------
// GET  — list SCIM tokens for the tenant (hash is never exposed)
// ---------------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const auth = await authorize(tenantSlug, true);
  if (auth.error) return auth.error;

  const adminClient = createServiceRoleClient();
  const { data: tokens, error } = await adminClient
    .from('scim_tokens')
    .select(TOKEN_LIST_FIELDS)
    .eq('tenant_id', auth.profile.tenant_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('scim list error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Determine the SCIM base URL for this tenant
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const scimUrl = supabaseUrl
    ? `${supabaseUrl}/functions/v1/scim/scim/v2`
    : '';

  return NextResponse.json({ tokens: tokens ?? [], scimUrl });
}

// ---------------------------------------------------------------------------
// POST  — generate a new SCIM token (plaintext shown once)
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const auth = await authorize(tenantSlug, false);
  if (auth.error) return auth.error;

  let body: { description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const plaintext = generateToken();
  const tokenHash = hashToken(plaintext);

  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from('scim_tokens')
    .insert({
      tenant_id: auth.profile.tenant_id,
      token_hash: tokenHash,
      description: body.description?.trim() || null,
      created_by: auth.profile.id,
    })
    .select(TOKEN_LIST_FIELDS)
    .single();

  if (error) {
    // Collision on token_hash (astronomically unlikely but handle gracefully)
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Token collision — please try again' }, { status: 409 });
    }
    console.error('scim create error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ token: data, plaintext }, { status: 201 });
}

// ---------------------------------------------------------------------------
// DELETE  — revoke a SCIM token (soft-delete via revoked_at)
// ---------------------------------------------------------------------------
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const auth = await authorize(tenantSlug, false);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Token id is required' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  // Verify token belongs to this tenant
  const { data: existing } = await adminClient
    .from('scim_tokens')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', auth.profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  const { error: updateError } = await adminClient
    .from('scim_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', auth.profile.tenant_id);

  if (updateError) {
    console.error('scim revoke error:', updateError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
