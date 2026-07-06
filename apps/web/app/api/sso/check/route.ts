import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// GET — check if SSO is available for a tenant (public, no auth required)
// Query params: ?tenant=<slug>
// Returns: { available: boolean, protocol?: string, name?: string }
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenant');

  if (!tenantSlug) {
    return NextResponse.json({ available: false, error: 'Missing tenant slug' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.json({ available: false, error: 'Server configuration error' }, { status: 500 });
  }

  // Use anon key with a client that doesn't need auth — we only read tenant
  // existence, then check SSO config via a direct DB query.
  try {
    const supabase = createClient(url, key);

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .maybeSingle();

    if (tenantError || !tenant) {
      return NextResponse.json({ available: false, error: 'Tenant not found' }, { status: 404 });
    }

    // Check for active SSO config
    const { data: cfg } = await supabase
      .from('tenant_sso_configs')
      .select('protocol')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!cfg) {
      return NextResponse.json({ available: false });
    }

    return NextResponse.json({
      available: true,
      protocol: cfg.protocol,
    });
  } catch (err) {
    console.error('sso check error:', err);
    return NextResponse.json({ available: false, error: 'Internal error' }, { status: 500 });
  }
}
