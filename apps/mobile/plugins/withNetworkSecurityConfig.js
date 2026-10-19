const fs = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const PIN_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const PRIMARY_PLACEHOLDER = 'REPLACE_WITH_PRIMARY_SPKI_PIN=';
const BACKUP_PLACEHOLDER = 'REPLACE_WITH_BACKUP_SPKI_PIN=';

function readPinsFromEnv(env) {
  const primary = typeof env.ANDROID_PRIMARY_SPKI_PIN === 'string' ? env.ANDROID_PRIMARY_SPKI_PIN.trim() : '';
  const backup = typeof env.ANDROID_BACKUP_SPKI_PIN === 'string' ? env.ANDROID_BACKUP_SPKI_PIN.trim() : '';
  if (!primary) throw new Error('ANDROID_PRIMARY_SPKI_PIN is required for Android release builds');
  if (!backup) throw new Error('ANDROID_BACKUP_SPKI_PIN is required for Android release builds');
  if (!PIN_PATTERN.test(primary) || !PIN_PATTERN.test(backup)) {
    throw new Error('Android SPKI pins must use the reviewed SHA-256 base64 format');
  }
  if (primary === backup) throw new Error('Android SPKI pins must be distinct');
  return { primary, backup };
}

function renderNetworkSecurityConfig(source, pins) {
  const rendered = source
    .replace(PRIMARY_PLACEHOLDER, pins.primary)
    .replace(BACKUP_PLACEHOLDER, pins.backup);
  if (rendered.includes(PRIMARY_PLACEHOLDER) || rendered.includes(BACKUP_PLACEHOLDER)) {
    throw new Error('Android network security template contains unresolved pin placeholders');
  }
  return rendered;
}

module.exports = function withNetworkSecurityConfig(config, pluginConfig = {}) {
  if (pluginConfig.requirePins !== true) {
    throw new Error('Android network security pins must be explicitly required');
  }

  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return mod;
  });

  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const pins = readPinsFromEnv(process.env);
      const sourcePath = path.join(mod.modRequest.projectRoot, 'native', 'android', 'network_security_config.xml');
      const targetPath = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml');
      const source = await fs.readFile(sourcePath, 'utf8');
      const rendered = renderNetworkSecurityConfig(source, pins);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, rendered, { encoding: 'utf8', mode: 0o600 });

      const debugManifest = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'debug', 'AndroidManifest.xml');
      try {
        const text = await fs.readFile(debugManifest, 'utf8');
        await fs.writeFile(
          debugManifest,
          text.replace(/android:usesCleartextTraffic="true"/g, 'android:usesCleartextTraffic="false"'),
        );
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return mod;
    },
  ]);
};

module.exports.readPinsFromEnv = readPinsFromEnv;
module.exports.renderNetworkSecurityConfig = renderNetworkSecurityConfig;
