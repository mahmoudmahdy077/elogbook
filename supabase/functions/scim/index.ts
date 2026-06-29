// supabase/functions/scim/index.ts
// Phase 6 / P6.11 — SCIM 2.0 /Users endpoint (shell).
//
// Implements the minimum surface needed to provision users from an
// enterprise IdP (Okta, Entra ID, JumpCloud) into E-Logbook:
//   GET    /scim/v2/Users         List users (filtered by tenant)
//   GET    /scim/v2/Users/{id}   Read one user
//   POST   /scim/v2/Users        Create user (calls invite_user)
//   PATCH  /scim/v2/Users/{id}   Update role / active state
//   DELETE /scim/v2/Users/{id}   Soft-disable the user
//
// Full SCIM 2.0 conformance (pagination, filtering, etag, /Groups,
// /ServiceProviderConfig, /Bulk, etc.) is out of scope for Phase 6.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeHex } from 'https://deno.land/std@0.168.0/encoding/hex.ts';

const SCIM_BASE = '/scim/v2';

const SCIM_USER_TO_PROFILE_ROLE: Record<string, string> = {
  'resident': 'resident',
  'supervisor': 'supervisor',
  'director': 'director',
  'admin': 'institution_admin',
  'institution_admin': 'institution_admin',
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/scim+json',
      ...extraHeaders,
    },
  });
}

function scimError(status: number, detail: string, scimType?: string) {
  return jsonResponse({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status,
    detail,
    ...(scimType ? { scimType } : {}),
  }, status);
}

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return encodeHex(new Uint8Array(buf));
}

async function authenticate(supabase: ReturnType<typeof createClient>, req: Request): Promise<{ tenantId: string } | Response> {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    return scimError(401, 'Missing bearer token');
  }
  const token = auth.slice(7).trim();
  if (!token) return scimError(401, 'Empty bearer token');

  const tokenHash = await hashToken(token);
  const { data, error } = await supabase
    .from('scim_tokens')
    .select('tenant_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) return scimError(500, error.message);
  if (!data) return scimError(401, 'Invalid bearer token');
  if (data.revoked_at) return scimError(401, 'Token revoked');

  // Best-effort last-used-at update (no await on the response).
  await supabase
    .from('scim_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash);

  return { tenantId: data.tenant_id };
}

function profileToScimUser(p: Record<string, unknown>) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: String(p.id),
    userName: String(p.user_email ?? p.email ?? ''),
    name: {
      givenName: String((p.full_name as string | null) ?? '').split(' ').slice(0, -1).join(' ') || null,
      familyName: String((p.full_name as string | null) ?? '').split(' ').slice(-1).join(' ') || null,
    },
    emails: [{ value: String(p.user_email ?? p.email ?? ''), primary: true }],
    active: p.disabled_at === null,
    meta: {
      resourceType: 'User',
      created: p.created_at,
      lastModified: p.updated_at ?? p.created_at,
    },
  };
}

serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return scimError(500, 'Server misconfiguration');
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const authResult = await authenticate(supabase, req);
  if (authResult instanceof Response) return authResult;
  const { tenantId } = authResult;

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, '');

  if (!path.startsWith(SCIM_BASE)) {
    return scimError(404, 'Not Found', 'invalidPath');
  }
  const subPath = path.slice(SCIM_BASE.length).replace(/^\//, '');

  if (subPath === 'Users' && req.method === 'GET') {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at, disabled_at, user_email:auth.users(email)')
      .eq('tenant_id', tenantId);
    if (error) return scimError(500, error.message);
    return jsonResponse({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: (data ?? []).length,
      Resources: (data ?? []).map((p) => profileToScimUser(p as Record<string, unknown>)),
    });
  }

  const userMatch = subPath.match(/^Users\/([0-9a-f-]{36})$/i);
  if (userMatch) {
    const userId = userMatch[1];
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, created_at, disabled_at, user_email:auth.users(email)')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) return scimError(500, error.message);
      if (!data) return scimError(404, 'User not found');
      return jsonResponse(profileToScimUser(data as Record<string, unknown>));
    }
    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('profiles')
        .update({ disabled_at: new Date().toISOString() })
        .eq('id', userId)
        .eq('tenant_id', tenantId);
      if (error) return scimError(500, error.message);
      return new Response(null, { status: 204 });
    }
    if (req.method === 'PATCH') {
      const body = await req.json().catch(() => ({}));
      const role = typeof body.role === 'string' ? SCIM_USER_TO_PROFILE_ROLE[body.role] : undefined;
      const updates: Record<string, unknown> = {};
      if (role) updates.role = role;
      if (typeof body.active === 'boolean') updates.disabled_at = body.active ? null : new Date().toISOString();
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .select('id, full_name, role, created_at, disabled_at, user_email:auth.users(email)')
        .maybeSingle();
      if (error) return scimError(500, error.message);
      if (!data) return scimError(404, 'User not found');
      return jsonResponse(profileToScimUser(data as Record<string, unknown>));
    }
  }

  if (subPath === 'Users' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const email = String(body.userName ?? body.email ?? '').trim();
    const fullName = String(body.name?.givenName ?? '') + ' ' + String(body.name?.familyName ?? '');
    const role = SCIM_USER_TO_PROFILE_ROLE[String(body.role ?? 'resident')] ?? 'resident';
    if (!email) return scimError(400, 'userName is required', 'invalidValue');

    // Use the invite_user RPC (defined in a prior migration) to create
    // the user. This sends the invite email and creates the profile.
    const { data, error } = await supabase.rpc('invite_user', {
      p_tenant_id: tenantId,
      p_email: email,
      p_full_name: fullName.trim() || email,
      p_role: role,
    });
    if (error) return scimError(500, error.message);
    const profileId = (data as { id?: string } | null)?.id;
    if (!profileId) return scimError(500, 'invite_user did not return a profile id');

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at, disabled_at, user_email:auth.users(email)')
      .eq('id', profileId)
      .single();
    if (!profile) return scimError(500, 'Created profile not readable');
    return jsonResponse(profileToScimUser(profile as Record<string, unknown>), 201);
  }

  return scimError(404, `No SCIM route for ${req.method} ${subPath}`);
});
