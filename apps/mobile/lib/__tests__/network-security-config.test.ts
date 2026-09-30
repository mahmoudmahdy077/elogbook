import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..', '..');
const sourcePath = join(mobileRoot, 'native', 'android', 'network_security_config.xml');
const generatedPath = join(mobileRoot, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
const appJson = JSON.parse(readFileSync(join(mobileRoot, 'app.json'), 'utf8'));
const require = createRequire(import.meta.url);
const networkSecurityPlugin = require(join(mobileRoot, 'plugins', 'withNetworkSecurityConfig.js'));

describe('Android network security configuration', () => {
  it('ships the tracked artifact referenced by the Expo plugin', () => {
    expect(existsSync(sourcePath)).toBe(true);
    const plugins = appJson.expo?.plugins ?? [];
    expect(plugins.some((plugin: unknown) =>
      (typeof plugin === 'string' && plugin.includes('withNetworkSecurityConfig'))
      || (Array.isArray(plugin) && plugin[0] === './plugins/withNetworkSecurityConfig'))).toBe(true);
  });

  it('disables cleartext traffic in the base and protected domain configs', () => {
    const xml = readFileSync(sourcePath, 'utf8');
    expect(xml).toMatch(/<base-config[^>]*cleartextTrafficPermitted="false"/);
    expect(xml).toMatch(/<domain-config[^>]*cleartextTrafficPermitted="false"/);
  });

  it('contains the protected Supabase domain and two SHA-256 pin slots', () => {
    const xml = readFileSync(sourcePath, 'utf8');
    expect(xml).toMatch(/<domain[^>]*>supabase\.co<\/domain>/);
    expect((xml.match(/<pin\s+digest="SHA-256">/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(xml).not.toMatch(/<pin\s+digest="SHA-1">/);
  });

  it('disables iOS arbitrary loads and does not use an unsupported plugin property', () => {
    expect(appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads).toBe(false);
    const plugins = appJson.expo?.plugins ?? [];
    const buildProperties = plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
    expect(buildProperties?.[1]?.android?.networkSecurityConfig).toBeUndefined();
  });

  it('injects two reviewed build-time pins without mutating the tracked template', () => {
    const primary = `${'A'.repeat(43)}=`;
    const backup = `${'B'.repeat(43)}=`;
    const pins = networkSecurityPlugin.readPinsFromEnv({
      ANDROID_PRIMARY_SPKI_PIN: primary,
      ANDROID_BACKUP_SPKI_PIN: backup,
    });
    const rendered = networkSecurityPlugin.renderNetworkSecurityConfig(
      readFileSync(sourcePath, 'utf8'),
      pins,
    );

    expect(pins).toEqual({ primary, backup });
    expect(rendered).toContain(`<pin digest="SHA-256">${primary}</pin>`);
    expect(rendered).toContain(`<pin digest="SHA-256">${backup}</pin>`);
    expect(rendered).not.toContain('REPLACE_WITH_PRIMARY_SPKI_PIN');
    expect(rendered).not.toContain('REPLACE_WITH_BACKUP_SPKI_PIN');
  });

  it('rejects missing, placeholder, malformed, and duplicate pin injection', () => {
    const primary = `${'A'.repeat(43)}=`;
    const backup = `${'B'.repeat(43)}=`;
    expect(() => networkSecurityPlugin.readPinsFromEnv({})).toThrow(/ANDROID_PRIMARY_SPKI_PIN/);
    expect(() => networkSecurityPlugin.readPinsFromEnv({
      ANDROID_PRIMARY_SPKI_PIN: 'REPLACE_WITH_PRIMARY_SPKI_PIN=',
      ANDROID_BACKUP_SPKI_PIN: backup,
    })).toThrow(/format/i);
    expect(() => networkSecurityPlugin.readPinsFromEnv({
      ANDROID_PRIMARY_SPKI_PIN: primary,
      ANDROID_BACKUP_SPKI_PIN: primary,
    })).toThrow(/distinct/i);
  });

  it('requires build-time injection and has no public plaintext fallback', () => {
    const plugin = readFileSync(join(mobileRoot, 'plugins', 'withNetworkSecurityConfig.js'), 'utf8');
    const pluginConfig = appJson.expo?.plugins?.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === './plugins/withNetworkSecurityConfig',
    ) as unknown[] | undefined;

    expect(pluginConfig?.[1]).toMatchObject({ requirePins: true });
    expect(plugin).toContain('readPinsFromEnv(process.env)');
    expect(plugin).toContain('renderNetworkSecurityConfig');
    expect(plugin).not.toContain('EXPO_PUBLIC');
    expect(plugin).not.toMatch(/copyFile\(source,\s*target\)/);
  });

  it('does not let the generated debug manifest re-enable cleartext traffic', () => {
    if (!existsSync(generatedPath)) return;
    const generated = readFileSync(join(mobileRoot, 'android', 'app', 'src', 'debug', 'AndroidManifest.xml'), 'utf8');
    expect(generated).not.toMatch(/android:usesCleartextTraffic="true"/);
  });
});
