import { describe, it, expect } from 'vitest';
import { validateAttachment, redactUri, ATTACHMENT_LIMITS } from '../attachments';

describe('attachments M4 (safe handling)', () => {
  it('accepts allowed image types within size', () => {
    expect(validateAttachment({ mime: 'image/jpeg', sizeBytes: 1024, name: 'photo.jpg' }).ok).toBe(true);
  });

  it('rejects disallowed MIME and oversize files', () => {
    expect(validateAttachment({ mime: 'application/x-msdownload', sizeBytes: 100, name: 'evil.exe' }).ok).toBe(false);
    expect(
      validateAttachment({ mime: 'image/jpeg', sizeBytes: ATTACHMENT_LIMITS.maxBytes + 1, name: 'big.jpg' }).ok,
    ).toBe(false);
  });

  it('rejects path traversal and token-bearing names', () => {
    expect(validateAttachment({ mime: 'image/png', sizeBytes: 10, name: '../../etc/passwd' }).ok).toBe(false);
    expect(validateAttachment({ mime: 'image/png', sizeBytes: 10, name: 'photo.jpg?token=secret' }).ok).toBe(false);
  });

  it('redacts URIs and tokens for logs/telemetry', () => {
    expect(redactUri('file:///data/photo.jpg?token=abc')).not.toContain('abc');
    expect(redactUri('https://x.supabase.co/storage/v1/object?apikey=secret')).not.toContain('secret');
  });
});
