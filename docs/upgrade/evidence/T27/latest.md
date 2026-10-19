# Qualification run 2026-09-28T18:28:32.381Z (b5b6dbc, fast)

pass 9 · fail 4 · blocked 9

- [FAIL] gate:verify-tenant-scope.mjs (1862ms) — Command failed: C:\Program Files\nodejs\node.exe G:\elogbook\scripts\verify-tenant-scope.mjs
Gate A FAILED: 1 service-role query(ies) on tenant-scoped table without .eq('tenant_id'
  G:\elogbook\apps\web\app\api\[tenant]\approvals\action\route.ts — from('case_entries') — .from('case_entries')

Checked 71 files importing createServiceRoleClient.
If intentional global, add: // tenant-scope-exempt: <reason> + code-owner approval + expiry

- [PASS] gate:verify-phi-claim.mjs (1596ms)
- [PASS] gate:verify-single-ip.mjs (2333ms)
- [PASS] gate:verify-exports.mjs (2196ms)
- [PASS] gate:verify-security-tests.mjs (1192ms)
- [PASS] gate:verify-credential-fail-closed.mjs (1401ms)
- [PASS] gate:verify-boot.mjs (789ms)
- [PASS] gate:verify-e2e-auth.mjs (626ms)
- [PASS] gate:verify-tokens.mjs (633ms)
- [PASS] gate:verify-compliance-evidence.mjs (889ms)
- [FAIL] unit:security-core (280ms) — Command failed: pnpm --filter @elogbook/web exec vitest run lib/__tests__/rate-limit-contract.test.ts lib/__tests__/client-ip.test.ts lib/__tests__/csp.test.ts lib/__tests__/e2e-cookie.test.ts lib/__tests__/theme-policy.test.ts lib/__tests__/site-content.test.ts lib/__tests__/dashboard-data.test.ts lib/__tests__/tenant-branding.test.ts lib/setup/__tests__/backup-manager.test.ts lib/setup/__tests__/db-migrator.test.ts lib/setup/__tests__/version-tracker.test.ts lib/supabase/__tests__/require-admi
- [FAIL] unit:ops (347ms) — Command failed: pnpm --filter @elogbook/ops test
'pnpm' is not recognized as an internal or external command,
operable program or batch file.

- [FAIL] unit:shared (517ms) — Command failed: pnpm --filter @elogbook/shared test
'pnpm' is not recognized as an internal or external command,
operable program or batch file.

- [BLOCKED] typecheck/lint/full-unit — needs: pass --full (slow; CI runs them per push)
- [BLOCKED] db-tests (pgTAP) — needs: Docker + `supabase start` (CI db-tests job runs them)
- [BLOCKED] deno-test — needs: deno toolchain (CI deno-test job runs it)
- [BLOCKED] e2e (Playwright) — needs: browsers + E2E secrets + running app (CI e2e job when E2E_ENABLED)
- [BLOCKED] docker-boot — needs: Docker (CI docker-boot job builds + probes)
- [BLOCKED] restore/upgrade fault injection — needs: throwaway VPS + off-host backup (T27 drills)
- [BLOCKED] load/soak + EXPLAIN — needs: qualified VPS + synthetic dataset (T26-full)
- [BLOCKED] accessibility/browser matrix — needs: browsers + manual keyboard pass (G5)
- [BLOCKED] G8 identifiable-data gate — needs: governance owner + independent assessment (T19b+)
