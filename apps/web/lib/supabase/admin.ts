import { createClient } from '@supabase/supabase-js';
import { parseWebServerEnv, parseWebPublicEnv } from '@elogbook/env';

export function createServiceRoleClient() {
  const env = parseWebServerEnv(process.env);
  const publicEnv = parseWebPublicEnv(process.env);
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}