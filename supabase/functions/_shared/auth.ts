import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://elogbook.dev',
  'https://app.elogbook.dev',
  'http://localhost:3000',
  'http://localhost:19006',
];

interface AuthResult {
  supabase: ReturnType<typeof createClient>;
  user: Awaited<ReturnType<ReturnType<typeof createClient>['auth']['getUser']>>['data']['user'];
  tenantId: string;
  role: string;
}

function getEnvVars(): { url: string; anonKey: string; serviceRoleKey: string } {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, anonKey, serviceRoleKey };
}

export async function authenticate(request: Request): Promise<AuthResult | Response> {
  let envVars: { url: string; anonKey: string; serviceRoleKey: string };
  try {
    envVars = getEnvVars();
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const token = authHeader.slice(7);

  const supabase = createClient(envVars.url, envVars.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id;
  const role = user.app_metadata?.role ?? user.user_metadata?.role ?? 'resident';

  if (!tenantId) {
    return new Response(
      JSON.stringify({ error: 'User has no tenant assignment' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const adminClient = createClient(envVars.url, envVars.serviceRoleKey);

  return { supabase: adminClient, user, tenantId, role };
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o))
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}