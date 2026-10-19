#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = join(root, 'apps', 'mobile');
const failures = [];
const releaseBlockers = [];
const fail = (message) => failures.push(message);
const blockRelease = (message) => releaseBlockers.push(message);

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    fail(`${path}: unreadable`);
    return '';
  }
};

const database = read(join(mobile, 'lib', 'db', 'database.ts'));
const dataAccess = read(join(mobile, 'lib', 'data-access.ts'));
const phiEncryption = read(join(mobile, 'lib', 'security', 'phi-encryption.ts'));
const appJsonText = read(join(mobile, 'app.json'));
const easText = read(join(mobile, 'eas.json'));
const mobileLogin = read(join(mobile, 'app', 'login.tsx'));
const webLogin = read(join(root, 'apps', 'web', 'app', 'login', 'page.tsx'));
const webAction = read(join(root, 'apps', 'web', 'app', 'login', 'actions.ts'));
const networkConfigTemplatePath = join(mobile, 'native', 'android', 'network_security_config.xml');
const generatedNetworkConfigPath = join(mobile, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
const networkSecurityPluginPath = join(mobile, 'plugins', 'withNetworkSecurityConfig.js');
const docsPath = join(root, 'docs', 'security', 'mobile-native-security.md');

if (!/process\.env\?\.NODE_ENV\s*===\s*['"]production['"]/.test(database)) {
  fail('apps/mobile/lib/db/database.ts: production plaintext guard is missing');
}
const initStart = database.indexOf('export async function initDatabase');
const guardIndex = database.indexOf('assertLocalClinicalStorageAllowed();', initStart);
const adapterIndex = database.indexOf('new SQLiteAdapter', initStart);
if (guardIndex < 0 || adapterIndex < 0 || guardIndex > adapterIndex) {
  fail('apps/mobile/lib/db/database.ts: plaintext adapter is reachable before the production guard');
}
const getStart = database.indexOf('export function getDatabase');
const getGuardIndex = database.indexOf('assertLocalClinicalStorageAllowed();', getStart);
if (getStart < 0 || getGuardIndex < 0) {
  fail('apps/mobile/lib/db/database.ts: getDatabase does not enforce the production guard');
}
if (/EXPO_PUBLIC_ENABLE_SQLCIPHER|encryptionKey\s*:/i.test(database)) {
  fail('apps/mobile/lib/db/database.ts: public or unverified encryption switch is present');
}
if (/sealedFv\s*\?\s*parsed\s*:\s*\(row\.fieldValues\s*\?\?\s*\{\}\)/.test(dataAccess)) {
  fail('apps/mobile/lib/data-access.ts: plaintext field_values fallback is present');
}
if (/return encryptedValue\s*;\s*\/\/ not encrypted/.test(phiEncryption)) {
  fail('apps/mobile/lib/security/phi-encryption.ts: plaintext decryption fallback is present');
}
if (/mfaVerifiedAt/.test(read(join(mobile, 'lib', 'capability.ts')))) {
  fail('apps/mobile/lib/capability.ts: mfaVerifiedAt remains in the capability contract');
}

let appJson;
let eas;
try {
  appJson = JSON.parse(appJsonText);
  eas = JSON.parse(easText);
} catch {
  fail('mobile configuration: app.json or eas.json is invalid JSON');
}
if (appJson) {
  const plugins = appJson.expo?.plugins ?? [];
  const buildProperties = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  if (buildProperties?.[1]?.android?.usesCleartextTraffic !== false) {
    fail('apps/mobile/app.json: Android cleartext traffic is not explicitly disabled');
  }
  if (plugins.some((plugin) => Array.isArray(plugin) && plugin[1]?.android?.networkSecurityConfig)) {
    fail('apps/mobile/app.json: unsupported networkSecurityConfig plugin property is present');
  }
  const networkSecurityPlugin = plugins.find((plugin) =>
    (typeof plugin === 'string' && plugin.includes('withNetworkSecurityConfig'))
    || (Array.isArray(plugin) && plugin[0] === './plugins/withNetworkSecurityConfig'));
  if (!networkSecurityPlugin) {
    fail('apps/mobile/app.json: network security config plugin is missing');
  } else if (!Array.isArray(networkSecurityPlugin) || networkSecurityPlugin[1]?.requirePins !== true) {
    fail('apps/mobile/app.json: network security config must require build-time pin injection');
  }
  if (appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== false) {
    fail('apps/mobile/app.json: iOS arbitrary loads are not explicitly disabled');
  }
}
if (eas) {
  for (const profile of ['production', 'preview']) {
    if (eas.build?.[profile]?.env?.NODE_ENV !== 'production') {
      fail(`apps/mobile/eas.json: ${profile} profile is not production-only`);
    }
  }
  if (/SHOW_DEMO_BANNER|DEMO_CREDENTIAL/i.test(easText)) {
    fail('apps/mobile/eas.json: demo credential configuration is present');
  }
}
if (!/NODE_ENV\s*!==\s*['"]production['"][\s\S]*NEXT_PUBLIC_SHOW_DEMO_BANNER/.test(webLogin)) {
  fail('apps/web/app/login/page.tsx: demo banner is not gated by production mode');
}
if (/\?\?\s*['"]demo['"]/.test(webAction)) {
  fail('apps/web/app/login/actions.ts: demo tenant fallback is present');
}
if (/@demo\.com|password123!/i.test(mobileLogin)) {
  fail('apps/mobile/app/login.tsx: demo credentials are present');
}

if (!existsSync(networkSecurityPluginPath)) {
  fail('apps/mobile/plugins/withNetworkSecurityConfig.js: pin injection plugin is missing');
} else {
  const plugin = read(networkSecurityPluginPath);
  if (!/readPinsFromEnv\(process\.env\)/.test(plugin) || !/renderNetworkSecurityConfig/.test(plugin)) {
    fail('apps/mobile/plugins/withNetworkSecurityConfig.js: build-time pin injection is missing');
  }
  if (/EXPO_PUBLIC|copyFile\(source,\s*target\)/.test(plugin)) {
    fail('apps/mobile/plugins/withNetworkSecurityConfig.js: plaintext pin fallback is forbidden');
  }
}

if (!existsSync(networkConfigTemplatePath)) {
  fail('apps/mobile/native/android/network_security_config.xml: referenced template is missing');
} else {
  const xml = read(networkConfigTemplatePath);
  if (!/<base-config[^>]*cleartextTrafficPermitted="false"/.test(xml)) {
    fail('apps/mobile/native/android/network_security_config.xml: cleartext base config is not disabled');
  }
  if (!/<domain[^>]*>supabase\.co<\/domain>/.test(xml)) {
    fail('apps/mobile/native/android/network_security_config.xml: protected domain is missing');
  }
  const templatePins = [...xml.matchAll(/<pin\s+digest="SHA-256">([^<]+)<\/pin>/g)].map((match) => match[1].trim());
  if (
    templatePins.length !== 2
    || !templatePins.includes('REPLACE_WITH_PRIMARY_SPKI_PIN=')
    || !templatePins.includes('REPLACE_WITH_BACKUP_SPKI_PIN=')
  ) {
    fail('apps/mobile/native/android/network_security_config.xml: template must contain only the primary and backup pin placeholders');
  }
}

if (!existsSync(generatedNetworkConfigPath)) {
  blockRelease('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: generated Android artifact is missing; run EAS prebuild with reviewed pins');
} else {
  const xml = read(generatedNetworkConfigPath);
  if (!/<base-config[^>]*cleartextTrafficPermitted="false"/.test(xml)) {
    fail('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: cleartext base config is not disabled');
  }
  if (!/<domain[^>]*>supabase\.co<\/domain>/.test(xml)) {
    fail('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: protected domain is missing');
  }
  const generatedPins = [...xml.matchAll(/<pin\s+digest="SHA-256">([^<]+)<\/pin>/g)].map((match) => match[1].trim());
  if (generatedPins.length < 2) {
    fail('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: at least two generated SHA-256 pins are required');
  } else if (generatedPins.some((pin) => /^(?:REPLACE|OPERATOR|TODO|INSERT|PASTE)/i.test(pin))) {
    blockRelease('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: unresolved generated SPKI pins are a release blocker');
  } else if (generatedPins.some((pin) => !/^[A-Za-z0-9+/]{43}=$/.test(pin))) {
    fail('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: invalid generated SPKI pin values');
  } else if (new Set(generatedPins).size !== generatedPins.length) {
    fail('apps/mobile/android/app/src/main/res/xml/network_security_config.xml: generated SPKI pins must be distinct');
  }
}

const generatedManifestPath = join(mobile, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const generatedDebugManifestPath = join(mobile, 'android', 'app', 'src', 'debug', 'AndroidManifest.xml');
if (existsSync(generatedManifestPath)) {
  const manifest = read(generatedManifestPath);
  if (!/android:networkSecurityConfig="@xml\/network_security_config"/.test(manifest)) {
    fail('apps/mobile/android/app/src/main/AndroidManifest.xml: network security config is not referenced');
  }
  if (!/android:usesCleartextTraffic="false"/.test(manifest)) {
    fail('apps/mobile/android/app/src/main/AndroidManifest.xml: cleartext traffic is not disabled');
  }
}
if (existsSync(generatedDebugManifestPath)) {
  const debugManifest = read(generatedDebugManifestPath);
  if (/android:usesCleartextTraffic="true"/.test(debugManifest)) {
    fail('apps/mobile/android/app/src/debug/AndroidManifest.xml: debug manifest re-enables cleartext traffic');
  }
}

if (!existsSync(docsPath)) {
  fail('docs/security/mobile-native-security.md: native security decision is missing');
} else {
  const docs = read(docsPath);
  if (!/pin rotation/i.test(docs) || !/SQLCipher/.test(docs)) {
    fail('docs/security/mobile-native-security.md: pin rotation or SQLCipher decision is not documented');
  }
  if (!/operator-provided/i.test(docs) || !/REPLACE_WITH_PRIMARY_SPKI_PIN/.test(docs) || !/REPLACE_WITH_BACKUP_SPKI_PIN/.test(docs)) {
    fail('docs/security/mobile-native-security.md: operator-provided unresolved pin template is missing');
  }
}

if (releaseBlockers.length > 0) {
  console.error(`verify-mobile-security: RELEASE BLOCKED (${releaseBlockers.length} unresolved native security decision(s))`);
  for (const blocker of releaseBlockers) console.error(` - ${blocker}`);
}
if (failures.length > 0) {
  console.error(`verify-mobile-security: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(` - ${failure}`);
}
if (releaseBlockers.length > 0 || failures.length > 0) process.exit(1);
console.log('verify-mobile-security: OK');
