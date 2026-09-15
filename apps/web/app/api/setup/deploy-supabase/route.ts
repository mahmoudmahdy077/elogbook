import { NextResponse } from 'next/server';
import { generateSupabaseSecrets, cloneSupabase, writeSupabaseEnv, getSupabaseVersion } from '@/lib/setup/supabase-installer';
import { isDockerAvailable, pullImage, networkExists } from '@/lib/setup/docker-api';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest, auditSetup,
} from '@/lib/setup/guard';
import { z } from 'zod';

export const runtime = 'nodejs';

// M8.1: strict deploy-input shape (count-checked secrets stay server-side).
const deployInputSchema = z.object({
  postgresPassword: z.string().min(8).max(256).optional(),
  postgresDb: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/).optional(),
  siteUrl: z.string().url().max(256).optional(),
});


export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // M8.1/N9: bootstrap boundary + token + origin + rate limit + durable lock.
  // Token use is durably accounted (replay-bounded); IP honors proxy trust.
  const clientIp = clientIpOfRequest(request);
  const gate = checkSetupRequest(
    {
      url: request.url,
      method: 'POST',
      headers: {
        'x-setup-token': request.headers.get('x-setup-token') ?? undefined,
        origin: request.headers.get('origin') ?? undefined,
        referer: request.headers.get('referer') ?? undefined,
      },
      ip: clientIp,
    },
    'deploy-supabase',
  );
  if (!gate.ok) {
    auditSetup('deploy-supabase', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const consumed = consumeSetupToken(
    request.headers.get('x-setup-token') ?? undefined, process.env.SETUP_BOOTSTRAP_TOKEN,
  );
  if (!consumed.ok) {
    auditSetup('deploy-supabase', 'denied');
    return NextResponse.json({ error: consumed.error }, { status: consumed.status });
  }
  const rl = checkRateLimit(clientIp, 'deploy-supabase');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });

  const body = await request.json();
  const parsed = deployInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid deploy inputs' }, { status: 400 });
  }
  if (!(await isDockerAvailable())) {
    return NextResponse.json({ error: 'Docker is not available' }, { status: 500 });
  }
  if (!acquireDurableLock('deploy-supabase')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }

  const { postgresPassword, postgresDb, siteUrl } = parsed.data;

  try {
    const config = generateSupabaseSecrets();
    if (postgresPassword) config.postgresPassword = postgresPassword;
    if (postgresDb) config.postgresDb = postgresDb;
    if (siteUrl) config.siteUrl = siteUrl;

    await cloneSupabase();
    writeSupabaseEnv(config);

    const images = [
      'supabase/postgres:17',
      'supabase/gotrue:v2.189.0',
      'postgrest/postgrest:v14.12',
      'supabase/realtime:v2.102.3',
      'supabase/storage-api:v1.60.4',
      'supabase/studio:latest',
      'supabase/postgres-meta:v0.96.6',
      'supabase/edge-runtime:v1.74.0',
      'supabase/supavisor:2.9.5',
      'darthsim/imgproxy:v3.30.1',
      'envoyproxy/envoy:v1.39.0',
    ];

    for (const image of images) {
      await pullImage(image);
    }

    execFileSync('docker', ['compose', 'up', '-d'], { cwd: '/opt/supabase', encoding: 'utf-8', timeout: 120000 });

    let retries = 30;
    while (retries > 0 && !(await networkExists('supabase_default'))) {
      await new Promise(r => setTimeout(r, 1000));
      retries--;
    }

    const configPath = join('/app/data', 'supabase-config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 }); // lgtm[js/missing-rate-limiting]

    const version = await getSupabaseVersion();

    // SECURITY: Never return infrastructure secrets (serviceRoleKey, jwtSecret,
    // postgresPassword) to the browser. They are written server-side with 0600
    // and consumed via env/config inside the private network only.
    auditSetup('deploy-supabase', 'ok');
    return NextResponse.json({
      success: true,
      apiUrl: config.apiUrl,
      version,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    auditSetup('deploy-supabase', 'error');
    return NextResponse.json({ error: errMsg }, { status: 500 });
  } finally {
    releaseDurableLock('deploy-supabase');
  }
}
