// P1.4: SCIM disabled until complete SCIM 2.0 implementation is verified
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
    JSON.stringify({ error: 'SCIM is disabled. SCIM 2.0 provisioning is not yet available.' }),
    {
      status: 503,
      headers,
    },
  );
});
