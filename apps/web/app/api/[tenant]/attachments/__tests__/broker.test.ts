import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments/upload-policy';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { getSecurityContext, type SecurityContextResult } from '@/lib/supabase/security-context';
import { checkRateLimit } from '@/lib/rate-limit-redis';
import { POST as uploadAttachment } from '../upload/route';
import { GET as downloadAttachment } from '../[id]/download/route';
import { DELETE as deleteAttachment } from '../[id]/route';

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn((retryAfter: number) =>
    new Response(JSON.stringify({ error: 'Too many requests.' }), {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    }),
  ),
}));

vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

const TENANT_ID = '00000000-0000-0000-0000-000000000101';
const PROFILE_ID = '00000000-0000-0000-0000-000000000201';
const OTHER_PROFILE_ID = '00000000-0000-0000-0000-000000000202';
const CASE_ID = '00000000-0000-0000-0000-000000000301';
const ATTACHMENT_ID = '00000000-0000-0000-0000-000000000401';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%%EOF');

interface Fixture {
  caseEntry?: Record<string, unknown> | null;
  attachment?: Record<string, unknown> | null;
  attachmentCount?: number;
  securityConfig?: Record<string, unknown> | null;
  securityConfigError?: { message: string } | null;
  storageUploadError?: { message: string } | null;
  insertError?: { message: string } | null;
  storageRemoveError?: { message: string } | null;
  deleteError?: { message: string } | null;
}

let fixture: Fixture;
let storageUpload: ReturnType<typeof vi.fn>;
let storageRemove: ReturnType<typeof vi.fn>;
let createSignedUrl: ReturnType<typeof vi.fn>;
let metadataInserts: Record<string, unknown>[];
let metadataDeletes: Array<Record<string, unknown>>;

function authenticated(overrides: Record<string, unknown> = {}): SecurityContextResult {
  return {
    ok: true as const,
    context: {
      user: { id: 'user-1' },
      profile: {
        id: PROFILE_ID,
        tenant_id: TENANT_ID,
        role: 'resident',
        status: 'active',
      },
      tenant: {
        id: TENANT_ID,
        slug: 'tenant-a',
        status: 'active',
      },
      aal: 'aal1',
      ...overrides,
    },
  } as unknown as SecurityContextResult;
}

function selectable(getResult: () => Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => {
    const result = getResult();
    const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
    return { data, error: result.error ?? null };
  });
  chain.then = (
    resolve: (value: Record<string, unknown>) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(getResult()).then(resolve, reject);
  return chain;
}

function mockAdmin() {
  storageUpload = vi.fn(async () => ({
    data: fixture.storageUploadError ? null : { path: 'quarantine/object' },
    error: fixture.storageUploadError ?? null,
  }));
  storageRemove = vi.fn(async () => ({
    data: fixture.storageRemoveError ? null : [],
    error: fixture.storageRemoveError ?? null,
  }));
  createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: 'https://storage.example/signed-object' },
    error: null,
  }));

  const attachmentRows = () => fixture.attachment ? [fixture.attachment] : [];
  const caseQuery = selectable(() => ({ data: fixture.caseEntry ?? null, error: null }));
  const attachmentQuery = selectable(() => ({
    data: attachmentRows(),
    count: fixture.attachmentCount ?? attachmentRows().length,
    error: null,
  }));
  const deleteQuery = selectable(() => ({ data: null, error: fixture.deleteError ?? null }));
  const securityConfigQuery = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: fixture.securityConfig ?? null,
          error: fixture.securityConfigError ?? null,
        })),
      })),
    })),
  };

  const caseAttachments = {
    select: vi.fn(() => attachmentQuery),
    insert: vi.fn(async (row: Record<string, unknown>) => {
      metadataInserts.push(row);
      return { data: fixture.insertError ? null : row, error: fixture.insertError ?? null };
    }),
    delete: vi.fn(() => deleteQuery),
  };

  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'case_entries') return { select: vi.fn(() => caseQuery) };
      if (table === 'case_attachments') return caseAttachments;
      if (table === 'attachment_security_config') return securityConfigQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
    storage: {
      from: vi.fn(() => ({
        upload: storageUpload,
        remove: storageRemove,
        createSignedUrl,
      })),
    },
  } as never);
}

function uploadRequest(
  bytes: Uint8Array = PDF_BYTES,
  fileName = 'report.pdf',
  headers: Record<string, string> = {},
) {
  return new Request('http://localhost/api/tenant-a/attachments/upload', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      origin: 'http://localhost',
      'x-attachment-case-id': CASE_ID,
      'x-attachment-file-name': encodeURIComponent(fileName),
      ...headers,
    },
    body: Uint8Array.from(bytes).buffer,
  });
}

const downloadContext = (id = ATTACHMENT_ID) => ({
  params: Promise.resolve({ tenant: 'tenant-a', id }),
});

function cleanAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    entry_id: CASE_ID,
    tenant_id: TENANT_ID,
    file_path: 'tenant-a/quarantine/case-a/report.pdf',
    file_name: 'report.pdf',
    file_type: 'application/pdf',
    mime_signature: 'application/pdf',
    file_size: PDF_BYTES.byteLength,
    uploaded_by: PROFILE_ID,
    malware_scan_status: 'clean',
    ...overrides,
  };
}

describe('attachment upload broker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfter: 0 });
    fixture = {
      caseEntry: {
        id: CASE_ID,
        tenant_id: TENANT_ID,
        resident_id: PROFILE_ID,
        deleted_at: null,
      },
      attachmentCount: 0,
    };
    metadataInserts = [];
    metadataDeletes = [];
    mockAdmin();
  });

  it('rejects unauthenticated uploads', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      status: 401,
    });

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(401);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('rejects a route tenant that differs from the authenticated tenant', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-b' }),
    });

    expect(response.status).toBe(403);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('rejects upload to a case owned by another resident', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.caseEntry = {
      id: CASE_ID,
      tenant_id: TENANT_ID,
      resident_id: OTHER_PROFILE_ID,
      deleted_at: null,
    };

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(403);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });

  it('rejects before storage when no approved scanner connector is configured', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.securityConfig = { scanner_enabled: false };

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Attachment scanning is unavailable',
      remediation: expect.stringMatching(/approved scanner connector/i),
    });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });

  it('rejects before storage when scanner activation is pending rather than approved', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.securityConfig = {
      scanner_enabled: true,
      scanner_connector_id: 'pending-review',
      scanner_connector_revision: 'pending',
      scanner_approval_reference: 'pending',
      scanner_timeout_ms: 30000,
      max_scan_bytes: MAX_ATTACHMENT_BYTES,
    };

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(503);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });

  it('does not inspect or persist spoofed bytes while scanner approval is absent', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await uploadAttachment(
      uploadRequest(new TextEncoder().encode('<script>alert(1)</script>'), 'report.pdf', {
        'content-type': 'application/pdf',
      }),
      { params: Promise.resolve({ tenant: 'tenant-a' }) },
    );

    expect(response.status).toBe(503);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });

  it('rejects an oversized declared content length before reading the body', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await uploadAttachment(
      uploadRequest(PDF_BYTES, 'report.pdf', {
        'content-length': String(MAX_ATTACHMENT_BYTES + 1),
      }),
      { params: Promise.resolve({ tenant: 'tenant-a' }) },
    );

    expect(response.status).toBe(413);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('does not persist unverified content when the connector registry is empty', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.securityConfig = {
      scanner_enabled: true,
      connector_approved: true,
      scanner_connector_id: 'connector-a',
      scanner_connector_revision: '2026-09-25.1',
      scanner_approval_reference: 'SEC-2026-001',
      scanner_timeout_ms: 30_000,
      max_scan_bytes: MAX_ATTACHMENT_BYTES,
    };

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(503);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });

  it('rate limits the upload route itself, before any body is read', async () => {
    // Uploads are the most expensive write path in the product: a bounded
    // stream, a magic-byte check, a storage PUT and a metadata insert per call.
    // An unthrottled route turns a single authenticated session into a storage
    // exhaustion primitive.
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 42 });

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });

  it('keys the upload rate limit on the caller, not the case', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    const [key] = vi.mocked(checkRateLimit).mock.calls[0] as [string, number];
    expect(key).toContain('attachment-upload');
    expect(key).toContain(PROFILE_ID);
  });

  it('never lets a browser or intermediary store an upload response', async () => {
    // The 202 body carries the attachment id and the quarantine path is derived
    // from it; a cached response would also survive the case being deleted.
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('marks the scanner-unavailable refusal no-store too', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await uploadAttachment(uploadRequest(), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('rejects a declared content length that is not a plain integer', async () => {
    // A declared length is a claim about the body; a non-integer claim is
    // refused before the body is touched, so the byte cap is never the only
    // thing standing between the process and a large allocation.
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await uploadAttachment(
      uploadRequest(PDF_BYTES, 'report.pdf', { 'content-length': '10 MiB' }),
      { params: Promise.resolve({ tenant: 'tenant-a' }) },
    );

    expect(response.status).toBe(400);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(metadataInserts).toHaveLength(0);
  });
});

describe('attachment download broker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture = { attachment: cleanAttachment(), attachmentCount: 1 };
    metadataInserts = [];
    metadataDeletes = [];
    mockAdmin();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PDF_BYTES, {
      headers: { 'content-type': 'application/pdf' },
    })));
  });

  it('rejects unauthenticated downloads', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue({
      ok: false,
      reason: 'unauthenticated',
      status: 401,
    });

    const response = await downloadAttachment(new Request('http://localhost'), downloadContext());

    expect(response.status).toBe(401);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('does not reveal an attachment from another tenant', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await downloadAttachment(new Request('http://localhost'), {
      params: Promise.resolve({ tenant: 'tenant-b', id: ATTACHMENT_ID }),
    });

    expect(response.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects a same-tenant non-owner resident', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.attachment = cleanAttachment({ uploaded_by: OTHER_PROFILE_ID });

    const response = await downloadAttachment(new Request('http://localhost'), downloadContext());

    expect(response.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it.each(['quarantined', 'pending', 'unknown'])('fails closed for %s scan status', async (status) => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.attachment = cleanAttachment({ malware_scan_status: status });

    const response = await downloadAttachment(new Request('http://localhost'), downloadContext());

    expect(response.status).toBe(409);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('allows a privileged tenant role to download a clean non-owner attachment', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated({
      profile: {
        id: PROFILE_ID,
        tenant_id: TENANT_ID,
        role: 'supervisor',
        status: 'active',
      },
    }));
    fixture.attachment = cleanAttachment({ uploaded_by: OTHER_PROFILE_ID });

    const response = await downloadAttachment(new Request('http://localhost'), downloadContext());

    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it('returns a proxied short-lived signed download to the clean owner', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await downloadAttachment(new Request('http://localhost'), downloadContext());

    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith(
      'tenant-a/quarantine/case-a/report.pdf',
      60,
      expect.objectContaining({ download: 'report.pdf' }),
    );
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.text()).toBe('%PDF-1.7\n%%EOF');
  });
});

describe('attachment delete broker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture = { attachment: cleanAttachment(), attachmentCount: 1 };
    metadataInserts = [];
    metadataDeletes = [];
    mockAdmin();
  });

  it('deletes the object and metadata through the service-role broker for the owner', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());

    const response = await deleteAttachment(new Request('http://localhost', { method: 'DELETE', headers: { origin: 'http://localhost' } }), downloadContext());

    expect(response.status).toBe(200);
    expect(storageRemove).toHaveBeenCalledWith(['tenant-a/quarantine/case-a/report.pdf']);
  });

  it('rejects a same-tenant non-owner mutation', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(authenticated());
    fixture.attachment = cleanAttachment({ uploaded_by: OTHER_PROFILE_ID });

    const response = await deleteAttachment(new Request('http://localhost', { method: 'DELETE', headers: { origin: 'http://localhost' } }), downloadContext());

    expect(response.status).toBe(403);
    expect(storageRemove).not.toHaveBeenCalled();
    expect(metadataDeletes).toHaveLength(0);
  });
});
