import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const CONFIG_DIR = '/app/config';
const CADDYFILE_PATH = join(CONFIG_DIR, 'Caddyfile');

export interface CaddyConfig {
  domain: string;
  appPort: number;
}

function ensureDir(filePath: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function generateCaddyfile(config: CaddyConfig): string {
  return `${config.domain} {
    reverse_proxy app:${config.appPort}

    header {
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    encode gzip

    log {
        output file /var/log/caddy/access.log
        format json
    }
}
`;
}

export function writeCaddyfile(config: CaddyConfig): string {
  const caddyfile = generateCaddyfile(config);
  ensureDir(CADDYFILE_PATH);
  writeFileSync(CADDYFILE_PATH, caddyfile, 'utf-8');
  return CADDYFILE_PATH;
}

export function getCaddyfilePath(): string {
  return CADDYFILE_PATH;
}

export function validateDomain(domain: string): { valid: boolean; error?: string } {
  if (!domain || domain.length < 3) {
    return { valid: false, error: 'Domain is too short' };
  }

  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, error: 'Invalid domain format' };
  }

  if (domain.includes('..')) {
    return { valid: false, error: 'Domain cannot contain consecutive dots' };
  }

  return { valid: true };
}
