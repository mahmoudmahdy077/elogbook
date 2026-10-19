import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPath = new URL('../../apps/web/components/CaseAttachments.tsx', import.meta.url);
const uploadPath = new URL('../../apps/web/app/api/[tenant]/attachments/upload/route.ts', import.meta.url);
const scannerPath = new URL('../../supabase/functions/process-attachment/index.ts', import.meta.url);
const scannerRuntimePath = new URL('../../supabase/functions/process-attachment/scanner.ts', import.meta.url);
const migrationPath = new URL('../../supabase/migrations/20260923000006_attachment_quarantine_storage.sql', import.meta.url);
const scannerGatePath = new URL('../../supabase/migrations/20260925000006_attachment_scanner_release_gate.sql', import.meta.url);

test('CaseAttachments uses the broker instead of direct clinical Storage mutation', async () => {
  const source = await readFile(componentPath, 'utf8');

  assert.doesNotMatch(source, /storage\s*\.\s*from\s*\(\s*['"]case-attachments['"]\s*\)/);
  assert.doesNotMatch(source, /\.(?:upload|remove|createSignedUrl)\s*\(/);
  assert.match(source, /attachments\/upload/);
  assert.match(source, /attachments\/\$\{encodeURIComponent\(a\.id\)\}\/download/);
  assert.match(source, /method:\s*['"]DELETE['"]/);
});

test('attachment quarantine migration denies ordinary mutation and defaults scanning off', async () => {
  const source = await readFile(migrationPath, 'utf8');
  const policyStatements = source.match(/CREATE POLICY[\s\S]*?;/g) ?? [];

  assert.match(source, /scanner_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(source, /ALTER COLUMN malware_scan_status SET DEFAULT 'quarantined'/);
  assert.match(source, /SET malware_scan_status = 'quarantined'[\s\S]*?WHERE malware_scan_status = 'clean'/);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.enforce_case_attachment_upload_limit/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*?ON public\.case_attachments/);
  assert.match(source, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE[\s\S]*?ON storage\.objects/);
  assert.equal(policyStatements.length, 1);
  assert.match(policyStatements[0], /FOR SELECT/);
  for (const policyName of [
    'tenant attachment access',
    'case_att_select_tenant_folder',
    'case_att_insert_tenant_folder',
    'case_att_update_tenant_folder',
    'case_att_delete_tenant_folder',
  ]) {
    assert.match(source, new RegExp(`DROP POLICY IF EXISTS "${policyName}" ON storage\\.objects`));
  }
});

test('upload broker requires an approved scanner before reading or persisting bytes', async () => {
  const source = await readFile(uploadPath, 'utf8');
  const readinessIndex = source.indexOf('getAttachmentScannerReadiness');
  const bodyIndex = source.indexOf('readBoundedBody(request)');
  const storageIndex = source.indexOf(".storage\n    .from('case-attachments')");

  assert.ok(readinessIndex >= 0, 'upload route must evaluate scanner readiness');
  assert.ok(bodyIndex > readinessIndex, 'scanner readiness must be checked before reading the body');
  assert.ok(storageIndex > readinessIndex, 'scanner readiness must be checked before storage');
  assert.match(source, /Attachment scanning is unavailable/);
  assert.match(source, /approved scanner connector/i);
  assert.doesNotMatch(source, /malware_scan_status:\s*['"](?:quarantined|clean|approved)['"]/);
});

test('forward migration prevents privileged scan-state release without a reviewed connector', async () => {
  const source = await readFile(scannerGatePath, 'utf8');

  assert.match(source, /scanner_connector_id TEXT/);
  assert.match(source, /scanner_connector_revision TEXT/);
  assert.match(source, /scanner_approval_reference TEXT/);
  assert.match(source, /scanner_timeout_ms INTEGER/);
  assert.match(source, /max_scan_bytes BIGINT/);
  assert.match(source, /REVOKE UPDATE[\s\S]*?ON public\.attachment_security_config[\s\S]*?FROM[\s\S]*?service_role/);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.request_attachment_scan/);
  assert.match(source, /SET malware_scan_status = 'pending'/);
  assert.doesNotMatch(source, /SET malware_scan_status = 'clean'/);
  assert.match(source, /FORBIDDEN_CONNECTOR/);
  assert.match(source, /FORBIDDEN_APPROVAL/);
  assert.match(source, /SET scanner_enabled = FALSE[\s\S]*connector_approved = FALSE/);
  assert.match(source, /NULLIF\(BTRIM\(NEW\.scanner_connector_id\), ''\) IS NULL/);
  assert.match(source, /NULLIF\(BTRIM\(NEW\.scanner_connector_revision\), ''\) IS NULL/);
  assert.match(source, /NULLIF\(BTRIM\(NEW\.scanner_approval_reference\), ''\) IS NULL/);
});

test('operational records describe pre-storage rejection and keep scanner approval external', async () => {
  const exceptions = await readFile(new URL('../../docs/security/exception-register.yaml', import.meta.url), 'utf8');
  const vendors = await readFile(new URL('../../docs/compliance/vendor-register.yaml', import.meta.url), 'utf8');
  const threatModel = await readFile(new URL('../../docs/security/threat-model.md', import.meta.url), 'utf8');

  assert.match(exceptions, /reject(?:s|ed)?[^\n]*uploads?[^\n]*before[^\n]*storage/i);
  assert.match(vendors, /baa_status:\s*pending/);
  assert.match(threatModel, /unsigned|pending/i);
});

test('process-attachment fails closed when no scanner adapter is configured', async () => {
  const source = await readFile(scannerPath, 'utf8');
  const runtime = await readFile(scannerRuntimePath, 'utf8');

  assert.match(source, /ATTACHMENT_SCANNER_ENABLED/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /request_attachment_scan/);
  assert.match(source, /Attachment scanner not configured[\s\S]*?status:\s*['"]pending['"][\s\S]*?},\s*503\)/);
  assert.match(source, /Attachment scanner adapter unavailable[\s\S]*?status:\s*['"]pending['"][\s\S]*?},\s*503\)/);
  assert.doesNotMatch(source, /malware_scan_status:\s*['"](?:clean|approved)['"]/);
  assert.match(runtime, /APPROVED_SCANNER_CONNECTORS[\s\S]*?new Map\(\)/);
  assert.match(runtime, /AbortSignal\.timeout/);
  assert.match(runtime, /status:\s*['"]pending['"]/);
  assert.doesNotMatch(runtime, /status:\s*['"](?:clean|approved)['"]/);
});
