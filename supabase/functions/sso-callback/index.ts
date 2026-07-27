// supabase/functions/sso-callback/index.ts
// SSO is disabled until a complete SAML/OIDC implementation is verified.
// See docs/upgrade-plan §DB-001. Returns 503 so callers fail loud.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async () => {
  return new Response(
    JSON.stringify({ error: 'SSO is disabled. Enterprise SSO is not yet available.' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
