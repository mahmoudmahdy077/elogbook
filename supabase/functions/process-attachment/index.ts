import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { resolveScannerConnector, runBoundedScan } from './scanner.ts';

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function hasServiceRoleClaim(token: string): boolean {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return false;

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as unknown;
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
    const role = (payload as Record<string, unknown>).role;
    if (role !== 'service_role') return false;
    return true;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > 4096)) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 4096) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Attachment scanner unavailable' }, 503);
  }

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token = authorization.slice('Bearer '.length);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user || !hasServiceRoleClaim(token)) {
    return json({ error: 'Service role required' }, 403);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const payload = await readJson(request);
  const attachmentId = typeof payload?.attachment_id === 'string' ? payload.attachment_id : '';
  if (!UUID_PATTERN.test(attachmentId)) {
    return json({ error: 'Invalid attachment id' }, 400);
  }

  const { data: queuedRows, error: queueError } = await serviceClient.rpc('request_attachment_scan', {
    p_attachment_id: attachmentId,
  });
  const queued = Array.isArray(queuedRows) ? queuedRows[0] : null;
  if (queueError) {
    return json({
      attachment_id: attachmentId,
      error: 'Attachment scanner unavailable',
      status: 'pending',
    }, 503);
  }
  if (!queued) {
    return json({ attachment_id: attachmentId, error: 'Attachment not found' }, 404);
  }

  const { data: config, error: configError } = await serviceClient
    .from('attachment_security_config')
    .select('scanner_enabled, connector_approved, scanner_connector_id, scanner_connector_revision, scanner_approval_reference, scanner_timeout_ms, max_scan_bytes')
    .eq('id', 1)
    .maybeSingle();
  const scanner = resolveScannerConnector(config ?? {}, {
    ATTACHMENT_SCANNER_ENABLED: Deno.env.get('ATTACHMENT_SCANNER_ENABLED'),
    ATTACHMENT_SCANNER_CONNECTOR_ID: Deno.env.get('ATTACHMENT_SCANNER_CONNECTOR_ID'),
    ATTACHMENT_SCANNER_CONNECTOR_REVISION: Deno.env.get('ATTACHMENT_SCANNER_CONNECTOR_REVISION'),
    ATTACHMENT_SCANNER_TIMEOUT_MS: Deno.env.get('ATTACHMENT_SCANNER_TIMEOUT_MS'),
    ATTACHMENT_SCANNER_MAX_BYTES: Deno.env.get('ATTACHMENT_SCANNER_MAX_BYTES'),
  });
  if (configError || ['scanner_disabled', 'connector_not_approved', 'approval_not_recorded', 'connector_mismatch', 'configuration_invalid'].includes(scanner.code)) {
    return json({
      attachment_id: attachmentId,
      error: 'Attachment scanner not configured',
      status: 'pending',
    }, 503);
  }
  if (!scanner.connector || scanner.code !== 'ready') {
    return json({
      attachment_id: attachmentId,
      error: 'Attachment scanner adapter unavailable',
      status: 'pending',
    }, 503);
  }

  const fileSize = typeof queued.file_size === 'number' ? queued.file_size : 0;
  if (fileSize < 1 || fileSize > scanner.maxBytes || typeof queued.file_path !== 'string') {
    return json({
      attachment_id: attachmentId,
      error: 'Attachment scanner rejected the file bounds',
      status: 'pending',
    }, 503);
  }

  const { data: object, error: downloadError } = await serviceClient.storage
    .from('case-attachments')
    .download(queued.file_path);
  if (downloadError || !object || object.size < 1 || object.size > scanner.maxBytes) {
    return json({
      attachment_id: attachmentId,
      error: 'Attachment scanner could not read the quarantined object',
      status: 'pending',
    }, 503);
  }

  const outcome = await runBoundedScan(
    scanner.connector,
    new Uint8Array(await object.arrayBuffer()),
    scanner.maxBytes,
    scanner.timeoutMs,
  );
  return json({
    attachment_id: attachmentId,
    error: outcome.status === 'pending'
      ? 'Attachment scanner timed out or failed'
      : 'Attachment release transition is not configured',
    status: 'pending',
  }, 503);
});
