# Mobile native security decision

## Current decision

The production mobile build does not expose the WatermelonDB `SQLiteAdapter` path. The repository contains a normal SQLite adapter without verified native SQLCipher wiring or a produced Android/iOS artifact proving database encryption. `initDatabase()` and `getDatabase()` therefore fail closed when `NODE_ENV=production`.

The supported local stores retain their existing field-level AEAD coverage for the fields they explicitly seal. That is not a whole-database encryption claim. No production offline clinical-data capability may be enabled until a reviewed SQLCipher-capable adapter, managed key flow, backup behavior, and signed Android/iOS artifact evidence are approved.

## Network security

`native/android/network_security_config.xml` is a tracked template rendered by `plugins/withNetworkSecurityConfig.js`. Cleartext traffic is disabled. Android release builds fail closed unless the build environment supplies valid, distinct `ANDROID_PRIMARY_SPKI_PIN` and `ANDROID_BACKUP_SPKI_PIN` values. The plugin renders those values only into the generated Android resource; it has no plaintext or `EXPO_PUBLIC_` fallback. The checked-in template keeps only unresolved placeholders, so it is never a trusted production configuration.

iOS App Transport Security disallows arbitrary loads, but iOS trust pinning requires a separate reviewed native implementation and artifact. It remains an external production decision and blocks qualification until implemented and inspected.

## Pin rotation runbook

1. Obtain the current and backup SPKI SHA-256 pins from the approved production endpoint through an independently authenticated release process.
2. Verify the endpoint hostname, certificate chain, and pin ownership before changing source configuration.
3. Configure the reviewed values as non-public EAS environment variables for the build: `ANDROID_PRIMARY_SPKI_PIN` and `ANDROID_BACKUP_SPKI_PIN`. Do not write them into `eas.json`, tracked source, or an `EXPO_PUBLIC_` runtime variable.
4. Run Expo prebuild, the mobile security gate, and the Android/iOS artifact inspection before promotion.
5. Release the new pin as an additional pin first, wait for the required overlap and telemetry window, then remove the retired pin.
6. If a pin fails, keep the known-good backup pin, stop promotion, and execute the documented rollback. Never replace the gate with a public runtime flag.
7. Re-verify after certificate renewal, endpoint migration, or any incident involving the protected host.

## Operator-provided pin template

The release operator must obtain both values through the approved, independently authenticated endpoint review and supply them to EAS as `ANDROID_PRIMARY_SPKI_PIN` and `ANDROID_BACKUP_SPKI_PIN` for the production and preview build environments. Keep the source template intentionally unresolved; the build must fail closed if either non-public variable is missing, malformed, or equal to the other:

```xml
<pin-set>
  <pin digest="SHA-256">REPLACE_WITH_PRIMARY_SPKI_PIN=</pin>
  <pin digest="SHA-256">REPLACE_WITH_BACKUP_SPKI_PIN=</pin>
</pin-set>
```

Do not generate, guess, copy from an unreviewed artifact, commit the reviewed values, or expose a runtime switch for them. A build without both EAS variables fails before the generated resource is written, and the security gate must report `RELEASE BLOCKED` while only the unresolved template exists or while a generated artifact contains a placeholder.

Production promotion is blocked until reviewed EAS-injected pins and generated Android artifact evidence, the iOS trust decision, and SQLCipher evidence are supplied and reviewed.
