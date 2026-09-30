import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('email producers enqueue bounded metadata rather than message bodies', async () => {
  const contact = await read('apps/web/app/api/contact/route.ts');
  const approvals = await read('apps/web/app/api/[tenant]/approvals/action/route.ts');
  const queue = await read('packages/shared/src/email/queue.ts');

  assert.match(contact, /contact_url/);
  assert.doesNotMatch(contact, /payload:\s*\{[^}]*message\s*:/s);
  assert.match(contact, /const \{ error: queueError \} = await admin\.from\('email_queue'\)\.insert/);
  assert.match(approvals, /payload:\s*\{\s*case_url:/s);
  assert.doesNotMatch(approvals, /reviewer_name|resident_name/);
  assert.match(queue, /validateEmailQueuePayload/);
  assert.doesNotMatch(queue, /input\.payload\s*:/);
});

test('worker validates payloads, audits before send, and persists only error codes', async () => {
  const worker = await read('apps/web/app/api/platform/email/process/route.ts');

  assert.match(worker, /validateEmailQueuePayload/);
  assert.match(worker, /createUnsubscribeToken/);
  assert.doesNotMatch(worker, /BULK_KEYS/);
  assert.match(worker, /phase:\s*'started'/);
  assert.match(worker, /audit_unavailable/);
  assert.match(worker, /provider_http_/);
  assert.doesNotMatch(worker, /last_error:\s*(?:message|errMsg)/);
  assert.doesNotMatch(worker, /error:\s*(?:message|errMsg)/);
});

test('webhook route is allowlisted, replay-safe, and transactional', async () => {
  const route = await read('apps/web/app/api/platform/email/webhook/route.ts');
  const migration = await read('supabase/migrations/20260925000009_email_delivery_event_rpc.sql');

  assert.match(route, /svixTimestampIsFresh/);
  assert.match(route, /svix-id/);
  assert.match(route, /record_email_delivery_event/);
  assert.doesNotMatch(route, /body\.data\?\.to\?\.\[0\]/);
  assert.match(migration, /ON CONFLICT \(provider, provider_event_id\) DO NOTHING/);
  assert.match(migration, /jsonb_array_length\(p_recipients\) > 100/);
  assert.match(migration, /tenant and template scope are ambiguous/);
  assert.doesNotMatch(migration, /RAISE EXCEPTION[^;]*(?:raw_body|response_body)/i);
});

test('forward migration preserves tenant scope and permits delivered status', async () => {
  const contractUrl = new URL('supabase/migrations/20260925000010_email_queue_delivery_contract.sql', root);
  assert.equal(existsSync(contractUrl), true, 'email queue/delivery contract migration must exist');
  if (!existsSync(contractUrl)) return;
  const contract = await readFile(contractUrl, 'utf8');
  const delivery = await read('supabase/migrations/20260925000009_email_delivery_event_rpc.sql');

  assert.match(contract, /CREATE OR REPLACE FUNCTION public\.claim_email_queue/);
  assert.match(contract, /tenant_id uuid/);
  assert.match(contract, /queue\.tenant_id/);
  assert.match(contract, /email_logs_status_check[\s\S]*'delivered'/);
  assert.match(delivery, /WHERE provider = p_provider\s+AND provider_id = p_provider_message_id/);
});

test('transport and test-send routes never expose raw provider error bodies', async () => {
  const resend = await read('packages/shared/src/email/resend.ts');
  const smtp = await read('packages/shared/src/email/smtp.ts');
  const testSend = await read('apps/web/app/api/platform/email/test/route.ts');

  assert.doesNotMatch(resend, /response\.text|res\.text|await\s+res\.json\(\).*error/s);
  assert.doesNotMatch(smtp, /err(?:or)?\.message|String\(err\)/);
  assert.doesNotMatch(testSend, /NextResponse\.json\(\{\s*error:\s*message/);
  assert.match(testSend, /email_send_audit/);
  assert.match(testSend, /phase:\s*'started'/);
});

test('forward email safety migration removes body variables and blocks queue payloads', async () => {
  const requestGuards = await read('scripts/verify-request-guards.mjs');
  const schema = await read('supabase/migrations/20260925000007_email_operational_safety.sql');
  const data = await read('supabase/migrations/20260925000008_email_legacy_payload_scrub.sql');

  assert.match(requestGuards, /apps\/web\/app\/api\/email\/unsubscribe\/route\.ts/);
  assert.match(requestGuards, /RFC 8058/);
  assert.match(requestGuards, /form-urlencoded/);
  assert.match(schema, /CREATE TABLE public\.email_send_audit/);
  assert.match(schema, /CREATE TABLE public\.email_unsubscribe_preferences/);
  assert.match(schema, /email_queue_reject_sensitive_payload/);
  assert.match(schema, /ALLOWED_PAYLOAD_KEYS/);
  assert.match(schema, /jsonb_typeof\(entry\.value\) <> 'string'/);
  assert.doesNotMatch(schema, /to_email\s+TEXT/);
  for (const variable of ['message', 'body_html', 'body_text', 'summary', 'reviewer_name', 'resident_name']) {
    assert.doesNotMatch(data, new RegExp(`\\{\\{${variable}\\}\\}`));
  }
  assert.match(data, /legacy_email_payload_removed/);
});
