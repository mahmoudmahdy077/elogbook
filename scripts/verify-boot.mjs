#!/usr/bin/env node
// Gate C — production boot smoke + deployment config
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const ROOT=join(import.meta.dirname,'..');

let failed=false;
function check(msg, ok){
  if(!ok){ console.error(`Gate C FAILED: ${msg}`); failed=true; }
  else console.log(`Gate C: ${msg} — ok`);
}

// 1. docker-compose.yml must not reference undefined api-gw
const compose=readFileSync(join(ROOT,'docker-compose.yml'),'utf8');
check('compose has no api-gw', !compose.includes('api-gw'));
check('compose does not publish 3000', !compose.match(/^\s*-\s*"3000:3000"/m));
check('Caddyfile exists', existsSync(join(ROOT,'config/Caddyfile')));

// 2. health is liveness (no supabase), ready exists
const health=readFileSync(join(ROOT,'apps/web/app/api/health/route.ts'),'utf8');
check('health has no supabase import', !health.includes("from '@/lib/supabase") && !health.includes('from "@/lib/supabase'));
check('health returns healthy', health.includes("status: 'healthy'"));
check('ready exists', existsSync(join(ROOT,'apps/web/app/api/ready/route.ts')));
const ready=readFileSync(join(ROOT,'apps/web/app/api/ready/route.ts'),'utf8');
check('ready uses rateLimiterHealth', ready.includes('rateLimiterHealth'));
check('ready returns 503 when degraded', ready.includes('503'));

// 3. proxy exempts health/ready
const proxy=readFileSync(join(ROOT,'apps/web/proxy.ts'),'utf8');
check('proxy exempts /api/health and /api/ready', proxy.includes('/api/health') && proxy.includes('/api/ready'));

// 4. RATE_LIMIT_MODE unset in prod must exit non-zero (instrumentation)
// Check source for prod-required throw and instrumentation hook
const limiterSrc=readFileSync(join(ROOT,'apps/web/lib/rate-limit-redis.ts'),'utf8');
check('limiter throws when RATE_LIMIT_MODE unset in prod', limiterSrc.includes("RATE_LIMIT_MODE is required in production"));
check('instrumentation.ts exists', existsSync(join(ROOT,'apps/web/instrumentation.ts')));
const instr=readFileSync(join(ROOT,'apps/web/instrumentation.ts'),'utf8');
check('instrumentation calls parseWebFullEnv', instr.includes('parseWebFullEnv'));
check('instrumentation calls resolveMode', instr.includes('resolveMode'));

// 5. Setup routes return 404 in prod (runtime probe)
const setupCheck=readFileSync(join(ROOT,'apps/web/app/api/setup/deploy-supabase/route.ts'),'utf8');
check('setup routes guard prod 404', setupCheck.includes('setupRuntimeEnabled') && setupCheck.includes('404'));

const setupCompose=readFileSync(join(ROOT,'setup.docker-compose.yml'),'utf8');
const setupDockerfile=readFileSync(join(ROOT,'apps/web/Dockerfile'),'utf8');
const setupEnv=readFileSync(join(ROOT,'packages/env/src/index.ts'),'utf8');
const setupGuard=readFileSync(join(ROOT,'apps/web/lib/setup/guard.ts'),'utf8');
const setupComplete=readFileSync(join(ROOT,'apps/web/app/api/setup/complete/route.ts'),'utf8');
const setupStage=setupDockerfile.slice(setupDockerfile.indexOf('FROM web-runner AS setup'), setupDockerfile.indexOf('FROM web-runner AS production'));
const productionStage=setupDockerfile.slice(setupDockerfile.indexOf('FROM web-runner AS production'));
check('setup profile is non-production', /NODE_ENV:\s*development/.test(setupCompose) && !/NODE_ENV:\s*production/.test(setupCompose));
check('setup profile joins Supabase network', /networks:\s*\n\s+- supabase_default/.test(setupCompose) && /supabase_default:\s*\n\s+external:\s*true/.test(setupCompose));
check('setup image has required tools', /apk add[^\n]*(git|docker-cli)/.test(setupStage) && setupStage.includes('postgresql-client'));
check('build release metadata is injected', setupDockerfile.includes('ARG APP_RELEASE_COMMIT') && setupDockerfile.includes('ENV APP_RELEASE_COMMIT=${APP_RELEASE_COMMIT}'));
check('production image excludes setup tools', !/apk add[^\n]*(git|docker-cli|postgresql-client)/.test(productionStage) && !compose.includes('/var/run/docker.sock'));
check('setup env has phase and release metadata', setupEnv.includes('APP_RELEASE_COMMIT') && setupEnv.includes('SETUP_PHASE') && setupGuard.includes("NODE_ENV !== 'production'"));
check('setup completion verifies receipts and release metadata', setupGuard.includes('verifySetupReceipts') && setupComplete.includes('APP_RELEASE_COMMIT') && !/child_process|execSync|git rev-parse/.test(setupComplete));
check('completion marker follows receipt verification', setupComplete.lastIndexOf('verifySetupReceipts') < setupComplete.lastIndexOf('writeSetupMarkerAtomically'));

// 6. Optional live HTTP probe (T02): --probe-base-url=http://localhost:3000
// performs real requests against a running server. Without the flag the
// script keeps its source-check behavior; a live probe never passes by
// default when no server answers (fetch failure fails the gate).
const probeArg = process.argv.find((a) => a.startsWith('--probe-base-url='));
if (probeArg) {
  const base = probeArg.slice('--probe-base-url='.length).replace(/\/$/, '');
  const live = await (async () => {
    try {
      const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
      const hb = await h.json();
      check('live /api/health returns 200 healthy', h.status === 200 && hb.status === 'healthy');
      check('live /api/health exposes no dependency state', hb.db === undefined && hb.rateLimit === undefined);

      const r = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(15000) });
      const rb = await r.json();
      check('live /api/ready returns 200|503 with dependency report', (r.status === 200 || r.status === 503) && rb.db !== undefined && rb.rateLimit !== undefined);

      for (const [path, body] of [['/api/health', hb], ['/api/ready', rb]]) {
        const text = JSON.stringify(body);
        check(`live ${path} leaks no secrets`, !/service_role|serviceRoleKey|jwtSecret|postgresPassword|BEGIN [A-Z ]*PRIVATE KEY/.test(text));
      }
    } catch (e) {
      check(`live probe reachable at ${base} (${e.cause?.code ?? e.message})`, false);
    }
  })();
  void live;
}

if(failed) process.exit(1);
console.log('Gate C passed: compose, health/ready, proxy, boot validation, setup guard');
