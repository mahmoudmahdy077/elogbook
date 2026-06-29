import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verify the network security config file ships with the project and that
// its structure is what Android expects. We can't actually test that the
// pins reject a MITM proxy without a running device; the cert-pinning
// contract is verified at integration time.

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..', '..');

describe('Android network_security_config', () => {
  const path = join(
    mobileRoot,
    'android',
    'app',
    'src',
    'main',
    'res',
    'xml',
    'network_security_config.xml',
  );

  it('exists at the expected path', () => {
    expect(existsSync(path)).toBe(true);
  });

  it('disables cleartext traffic globally', () => {
    const xml = readFileSync(path, 'utf8');
    expect(xml).toMatch(/cleartextTrafficPermitted="false"/);
  });

  it('pins the supabase.co domain', () => {
    const xml = readFileSync(path, 'utf8');
    expect(xml).toMatch(/<domain[^>]*>supabase\.co<\/domain>/);
  });

  it('declares at least two pins (leaf + backup)', () => {
    const xml = readFileSync(path, 'utf8');
    const pinCount = (xml.match(/<pin digest="SHA-256">/g) ?? []).length;
    expect(pinCount).toBeGreaterThanOrEqual(2);
  });

  it('uses SHA-256 digests (not SHA-1)', () => {
    const xml = readFileSync(path, 'utf8');
    expect(xml).not.toMatch(/<pin digest="SHA-1">/);
  });

  it('references the config from app.json', () => {
    const appJson = JSON.parse(readFileSync(join(mobileRoot, 'app.json'), 'utf8'));
    expect(appJson.expo.android.networkSecurityConfig).toMatch(
      /network_security_config\.xml$/,
    );
  });
});
