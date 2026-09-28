// supabase/functions/sso-callback/index.ts
// SSO is disabled until a complete SAML/OIDC implementation is verified.
// See docs/upgrade-plan §DB-001. Returns 503 so callers fail loud.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/auth.ts';

serve(async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(req.headers.get('Origin')),
  };
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }
  return new Response(
    JSON.stringify({ error: 'SSO is disabled. Enterprise SSO is not yet available.' }),
    {
      status: 503,
      headers,
    },
  );
});
