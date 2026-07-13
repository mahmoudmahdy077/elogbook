// P1.3: Webhook dispatch disabled until outbox pattern + durable delivery implemented
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async () => {
  return new Response(
    JSON.stringify({ error: 'Webhook dispatch is disabled. Durable webhook delivery is not yet available.' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
