import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260923000011_privileged_aal2.sql', 'utf8');

const guardedFunctions = [
  'approve_case',
  'reject_case',
  'get_dashboard_data',
  'get_analytics_data',
  'get_report_counts',
  'get_duty_4wk_violations',
  'get_template_usage_counts',
  'check_case_quota',
  'set_data_retention',
  'grant_ai_quota',
  'store_ai_config',
  'store_payment_gateway_secret',
  'store_tenant_webhook',
  'relabel_case_mode',
  'submit_case_operation',
  'soft_delete_case',
];

test('forward migration wraps every privileged user RPC with authoritative AAL checks', () => {
  for (const functionName of guardedFunctions) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}\\(`));
  }
  assert.match(migration, /require_privileged_principal/);
  assert.match(migration, /get_authoritative_principal_with_aal/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.__a2_/);
});

test('forward migration revokes public, anonymous, and service-role user RPC grants', () => {
  assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_dashboard_data/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.approve_case/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_analytics_data/);
});
