import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, normalize } from 'path';
import crypto from 'crypto';

const SUPABASE_REPO = 'https://github.com/supabase/supabase.git';
const SUPABASE_DEFAULT_PATH = '/opt/supabase';

function assertSafePath(base: string, target: string): void {
  const resolved = resolve(base, target);
  if (!resolved.startsWith(base)) {
    throw new Error(`Path traversal detected: ${target}`);
  }
}

export interface SupabaseConfig {
  installPath: string;
  postgresPassword: string;
  postgresDb: string;
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
  secretKeyBase: string;
  vaultEncKey: string;
  pgMetaCryptoKey: string;
  apiUrl: string;
  siteUrl: string;
}

function generateHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateJWT(secret: string, payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function generateSupabaseSecrets(): SupabaseConfig {
  const jwtSecret = generateHex(64);
  const now = Math.floor(Date.now() / 1000);

  const anonKey = generateJWT(jwtSecret, {
    role: 'anon',
    iss: 'supabase',
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10,
  });

  const serviceRoleKey = generateJWT(jwtSecret, {
    role: 'service_role',
    iss: 'supabase',
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10,
  });

  return {
    installPath: SUPABASE_DEFAULT_PATH,
    postgresPassword: generateHex(16),
    postgresDb: 'supabase',
    jwtSecret,
    anonKey,
    serviceRoleKey,
    secretKeyBase: generateHex(64),
    vaultEncKey: generateHex(32),
    pgMetaCryptoKey: generateHex(32),
    apiUrl: 'http://localhost:8000',
    siteUrl: 'http://localhost:3000',
  };
}

export async function cloneSupabase(installPath: string): Promise<void> {
  assertSafePath(SUPABASE_DEFAULT_PATH, installPath);
  if (existsSync(join(installPath, '.git'))) {
    execSync('git pull origin master', { cwd: installPath, encoding: 'utf-8', timeout: 120000 });
  } else {
    execSync(`git clone --depth 1 ${SUPABASE_REPO} ${installPath}`, { encoding: 'utf-8', timeout: 300000 });
  }
}

export function writeSupabaseEnv(installPath: string, config: SupabaseConfig): void {
  assertSafePath(SUPABASE_DEFAULT_PATH, installPath);
  const envContent = [
    `POSTGRES_PASSWORD=${config.postgresPassword}`,
    `POSTGRES_DB=${config.postgresDb}`,
    'POSTGRES_HOST=db',
    'POSTGRES_PORT=5432',
    '',
    `JWT_SECRET=${config.jwtSecret}`,
    'JWT_EXPIRY=3600',
    '',
    `ANON_KEY=${config.anonKey}`,
    `SERVICE_ROLE_KEY=${config.serviceRoleKey}`,
    '',
    `SECRET_KEY_BASE=${config.secretKeyBase}`,
    `VAULT_ENC_KEY=${config.vaultEncKey}`,
    `PG_META_CRYPTO_KEY=${config.pgMetaCryptoKey}`,
    '',
    `API_EXTERNAL_URL=${config.apiUrl}`,
    `SUPABASE_PUBLIC_URL=${config.apiUrl}`,
    `SITE_URL=${config.siteUrl}`,
    '',
    'STUDIO_DEFAULT_ORGANIZATION=My Organization',
    'STUDIO_DEFAULT_PROJECT=My Project',
    '',
    'ENABLE_EMAIL_SIGNUP=true',
    'ENABLE_EMAIL_AUTOCONFIRM=true',
    'ENABLE_ANONYMOUS_USERS=false',
    'DISABLE_SIGNUP=false',
    '',
    'SMTP_ADMIN_EMAIL=admin@example.com',
    'SMTP_HOST=',
    'SMTP_PORT=587',
    'SMTP_USER=',
    'SMTP_PASS=',
    'SMTP_SENDER_NAME=E-Logbook',
    '',
    'ENABLE_PHONE_SIGNUP=false',
    'ENABLE_PHONE_AUTOCONFIRM=true',
    '',
    'FUNCTIONS_VERIFY_JWT=true',
    '',
    'STORAGE_TENANT_ID=storage-s3',
    'REGION=local',
    '',
    'POOLER_PROXY_PORT_TRANSACTION=6543',
    'POOLER_TENANT_ID=pooler-tenant',
    'POOLER_DEFAULT_POOL_SIZE=20',
    'POOLER_MAX_CLIENT_CONN=100',
    'POOLER_DB_POOL_SIZE=10',
  ].join('\n');

  mkdirSync(installPath, { recursive: true });
  writeFileSync(join(installPath, '.env'), envContent, 'utf-8');
}

export function getSupabaseEnvPath(installPath: string): string {
  return join(installPath, '.env');
}

export async function getSupabaseVersion(installPath: string): Promise<string> {
  assertSafePath(SUPABASE_DEFAULT_PATH, installPath);
  try {
    const version = execSync('git describe --tags --abbrev=0', { cwd: installPath, encoding: 'utf-8', timeout: 10000 });
    return version.trim();
  } catch {
    return 'unknown';
  }
}
