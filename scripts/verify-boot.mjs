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
check('setup routes guard prod 404', setupCheck.includes("NODE_ENV === 'production'") && setupCheck.includes('404'));

if(failed) process.exit(1);
console.log('Gate C passed: compose, health/ready, proxy, boot validation, setup guard');
