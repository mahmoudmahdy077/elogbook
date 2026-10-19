import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_CASE,
  validateAttachmentUpload,
} from '../upload-policy';

const encoder = new TextEncoder();

const pdf = encoder.encode('%PDF-1.7\n%%EOF');
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);

describe('validateAttachmentUpload', () => {
  it.each([
    ['PDF', pdf, 'report.pdf', 'application/pdf'],
    ['PNG', png, 'image.png', 'image/png'],
    ['JPEG', jpeg, 'photo.jpeg', 'image/jpeg'],
  ])('detects %s from magic bytes instead of the declared MIME type', (_label, bytes, fileName, expectedType) => {
    const result = validateAttachmentUpload({
      bytes,
      fileName,
      currentCount: 0,
      declaredMimeType: 'application/octet-stream',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        fileName,
        mediaType: expectedType,
        size: bytes.byteLength,
      },
    });
  });

  it('rejects content that spoofs a PDF MIME type and extension', () => {
    const result = validateAttachmentUpload({
      bytes: encoder.encode('<script>alert(1)</script>'),
      fileName: 'report.pdf',
      currentCount: 0,
      declaredMimeType: 'application/pdf',
    });

    expect(result).toMatchObject({ ok: false, code: 'unsupported_type' });
  });

  it('rejects files larger than the byte limit', () => {
    const result = validateAttachmentUpload({
      bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      fileName: 'large.pdf',
      currentCount: 0,
    });

    expect(result).toMatchObject({ ok: false, code: 'too_large' });
  });

  it('rejects empty files', () => {
    const result = validateAttachmentUpload({
      bytes: new Uint8Array(),
      fileName: 'empty.pdf',
      currentCount: 0,
    });

    expect(result).toMatchObject({ ok: false, code: 'empty' });
  });

  it('rejects a case at the attachment count limit', () => {
    const result = validateAttachmentUpload({
      bytes: pdf,
      fileName: 'report.pdf',
      currentCount: MAX_ATTACHMENTS_PER_CASE,
    });

    expect(result).toMatchObject({ ok: false, code: 'count_exceeded' });
  });

  it('rejects path-like and control-character file names', () => {
    for (const fileName of ['../report.pdf', 'folder/report.pdf', 'report\u0000.pdf']) {
      expect(validateAttachmentUpload({ bytes: pdf, fileName, currentCount: 0 })).toMatchObject({
        ok: false,
        code: 'invalid_name',
      });
    }
  });

  it('rejects an extension that contradicts the detected bytes', () => {
    const result = validateAttachmentUpload({
      bytes: pdf,
      fileName: 'report.png',
      currentCount: 0,
    });

    expect(result).toMatchObject({ ok: false, code: 'extension_mismatch' });
  });

  it('rejects truncated JPEG data', () => {
    const result = validateAttachmentUpload({
      bytes: jpeg.slice(0, -2),
      fileName: 'photo.jpg',
      currentCount: 0,
    });

    expect(result).toMatchObject({ ok: false, code: 'unsupported_type' });
  });
});
