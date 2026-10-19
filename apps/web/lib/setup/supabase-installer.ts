import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const SUPABASE_REPO = 'https://github.com/supabase/supabase.git';
const SUPABASE_PATH = '/opt/supabase';

export interface SupabaseConfig {
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

export interface SupabaseSmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  adminEmail: string;
  senderName: string;
}

function resolveSmtpConfig(smtp?: SupabaseSmtpConfig): SupabaseSmtpConfig {
  const resolved: SupabaseSmtpConfig = smtp ?? {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587) || 587,
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    adminEmail: process.env.SMTP_ADMIN_EMAIL ?? process.env.EMAIL_FROM ?? '',
    senderName: process.env.SMTP_SENDER_NAME ?? 'E-Logbook',
  };
  if (!resolved.host || !resolved.host.trim()) {
    throw new Error(
      'writeSupabaseEnv: SMTP host is empty — refusing to write silently-broken Supabase env. ' +
        'Set SMTP_HOST (with SMTP_USER/SMTP_PASS/SMTP_ADMIN_EMAIL) before deploying Supabase.',
    );
  }
  return {
    host: resolved.host.trim(),
    port: resolved.port,
    user: resolved.user,
    pass: resolved.pass,
    adminEmail: resolved.adminEmail,
    senderName: resolved.senderName,
  };
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

export async function cloneSupabase(): Promise<void> {
  const p = SUPABASE_PATH;
  if (existsSync(join(p, '.git'))) {
    execFileSync('git', ['pull', 'origin', 'master'], { cwd: p, encoding: 'utf-8', timeout: 120000 });
  } else {
    execFileSync('git', ['clone', '--depth', '1', SUPABASE_REPO, p], { encoding: 'utf-8', timeout: 300000 });
  }
}

export function writeSupabaseEnv(config: SupabaseConfig, smtp?: SupabaseSmtpConfig): void {
  const p = SUPABASE_PATH;
  const mail = resolveSmtpConfig(smtp);
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
    // Secure default: require email confirmation. Local dev without SMTP
    // must either configure SMTP_* below or manually confirm users in
    // Studio (Authentication > Users). Do NOT set true in production.
    'ENABLE_EMAIL_AUTOCONFIRM=false',
    'ENABLE_ANONYMOUS_USERS=false',
    'DISABLE_SIGNUP=false',
    '',
    `SMTP_ADMIN_EMAIL=${mail.adminEmail}`,
    `SMTP_HOST=${mail.host}`,
    `SMTP_PORT=${mail.port}`,
    `SMTP_USER=${mail.user}`,
    `SMTP_PASS=${mail.pass}`,
    `SMTP_SENDER_NAME=${mail.senderName}`,
    '',
    `GOTRUE_MAILER_SMTP_HOST=${mail.host}`,
    `GOTRUE_MAILER_SMTP_PORT=${mail.port}`,
    `GOTRUE_MAILER_SMTP_USER=${mail.user}`,
    `GOTRUE_MAILER_SMTP_PASS=${mail.pass}`,
    `GOTRUE_MAILER_SMTP_ADMIN_EMAIL=${mail.adminEmail}`,
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

  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, '.env'), envContent, 'utf-8'); // lgtm[js/missing-rate-limiting]
}

export async function getSupabaseVersion(): Promise<string> {
  const p = SUPABASE_PATH;
  try {
    const version = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: p, encoding: 'utf-8', timeout: 10000 });
    return version.trim();
  } catch {
    return 'unknown';
  }
}
