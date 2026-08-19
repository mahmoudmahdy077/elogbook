import { NextResponse } from 'next/server';
import { generateSupabaseSecrets, cloneSupabase, writeSupabaseEnv, getSupabaseVersion } from '@/lib/setup/supabase-installer';
import { isDockerAvailable, pullImage, networkExists } from '@/lib/setup/docker-api';
import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export const runtime = 'nodejs';

const ALLOWED_BASE = '/opt/supabase';

function isSafePath(userPath: string): boolean {
  if (!userPath || typeof userPath !== 'string') return false;
  const resolved = resolve(ALLOWED_BASE, userPath);
  return resolved === ALLOWED_BASE || resolved.startsWith(ALLOWED_BASE + '/');
}

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function POST(request: Request) {
  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  const body = await request.json();
  const { installPath, postgresPassword, postgresDb, siteUrl } = body;

  if (!(await isDockerAvailable())) {
    return NextResponse.json({ error: 'Docker is not available' }, { status: 500 });
  }

  try {
    const config = generateSupabaseSecrets();
    config.installPath = installPath || '/opt/supabase';

    if (!isSafePath(config.installPath)) {
      return NextResponse.json({ error: 'Invalid install path' }, { status: 400 });
    }
    const resolvedPath = resolve(ALLOWED_BASE, config.installPath);

    if (postgresPassword) config.postgresPassword = postgresPassword;
    if (postgresDb) config.postgresDb = postgresDb;
    if (siteUrl) config.siteUrl = siteUrl;

    await cloneSupabase(resolvedPath);
    writeSupabaseEnv(resolvedPath, config);

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

    execSync('docker compose up -d', { cwd: resolvedPath, encoding: 'utf-8', timeout: 120000 });

    let retries = 30;
    while (retries > 0 && !(await networkExists('supabase_default'))) {
      await new Promise(r => setTimeout(r, 1000));
      retries--;
    }

    const configPath = join('/app/data', 'supabase-config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const version = await getSupabaseVersion(resolvedPath);

    return NextResponse.json({
      success: true,
      config: {
        installPath: resolvedPath,
        apiUrl: config.apiUrl,
        anonKey: config.anonKey,
        serviceRoleKey: config.serviceRoleKey,
        jwtSecret: config.jwtSecret,
        postgresPassword: config.postgresPassword,
        postgresDb: config.postgresDb,
      },
      version,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
