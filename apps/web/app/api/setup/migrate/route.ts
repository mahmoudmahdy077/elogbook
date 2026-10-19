import { NextResponse } from 'next/server';
import { runMigrations } from '@/lib/setup/db-migrator';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest, migrateInputSchema, auditSetup, setupRuntimeEnabled,
  writeSetupReceiptAtomically, removeSetupReceipt,
} from '@/lib/setup/guard';
import { guardRequest } from '@/lib/http/request-guard';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (!setupRuntimeEnabled()) {
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
        'x-forwarded-proto': request.headers.get('x-forwarded-proto') ?? undefined,
        origin: request.headers.get('origin') ?? undefined,
        referer: request.headers.get('referer') ?? undefined,
      },
      ip: clientIp,
    },
    'migrate',
  );
  if (!gate.ok) {
    auditSetup('migrate', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const consumed = consumeSetupToken(
    request.headers.get('x-setup-token') ?? undefined, process.env.SETUP_BOOTSTRAP_TOKEN,
  );
  if (!consumed.ok) {
    auditSetup('migrate', 'denied');
    return NextResponse.json({ error: consumed.error }, { status: consumed.status });
  }
  const rl = checkRateLimit(clientIp, 'migrate');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });

  const guarded = await guardRequest(request, migrateInputSchema, {
    requireOrigin: false,
    maxBodyBytes: 16 * 1024,
  });
  if (!guarded.ok) return guarded.response;
  const creds = { success: true as const, data: guarded.data };
  if (!acquireDurableLock('migrate')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }
  removeSetupReceipt('migrations-applied.json');

  try {

    const { host, port, database, user, password } = creds.data;

    const configPath = join('/app/data', 'supabase-config.json');
    let dbConfig = { host: 'db', port: 5432, database: 'supabase', user: 'postgres', password: '' };

    if (existsSync(configPath)) {
      const savedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      dbConfig = {
        host: host || 'db',
        port: port || 5432,
        database: database || savedConfig.postgresDb || 'supabase',
        user: user || 'postgres',
        password: password || savedConfig.postgresPassword || '',
      };
    } else {
      dbConfig = { host, port, database, user, password: password ?? '' };
    }

    const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
    const results = await runMigrations(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, migrationsDir);

    const errors = results.filter(r => r.status === 'error');
    auditSetup('migrate', errors.length === 0 ? 'ok' : 'errors');
    if (errors.length === 0) {
      writeSetupReceiptAtomically('migrations-applied.json', {
        success: true,
        completed_at: new Date().toISOString(),
        total: results.length,
        applied: results.filter(r => r.status === 'success').length,
        errors: [],
      });
    } else {
      removeSetupReceipt('migrations-applied.json');
    }
    return NextResponse.json({
      success: errors.length === 0,
      total: results.length,
      applied: results.filter(r => r.status === 'success').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: errors.map(e => ({ file: e.file, error: e.error })),
    });
  } catch (error) {
    removeSetupReceipt('migrations-applied.json');
    throw error;
  } finally {
    releaseDurableLock('migrate');
  }
}
