// P1.4: SCIM disabled until complete SCIM 2.0 implementation is verified
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async () => {
  return new Response(
    JSON.stringify({ error: 'SCIM is disabled. SCIM 2.0 provisioning is not yet available.' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
