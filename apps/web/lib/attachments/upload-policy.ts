export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_CASE = 20;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 180;

export type SupportedAttachmentMediaType = 'application/pdf' | 'image/png' | 'image/jpeg';

export type AttachmentValidationInput = {
  bytes: Uint8Array;
  fileName: string;
  currentCount: number;
  declaredMimeType?: string | null;
};

export type AttachmentValidationResult =
  | {
      ok: true;
      value: {
        fileName: string;
        mediaType: SupportedAttachmentMediaType;
        size: number;
      };
    }
  | {
      ok: false;
      code: 'empty' | 'too_large' | 'count_exceeded' | 'invalid_name' | 'unsupported_type' | 'extension_mismatch';
      message: string;
    };

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function endsWith(bytes: Uint8Array, signature: number[]): boolean {
  const offset = bytes.byteLength - signature.length;
  return offset >= 0 && signature.every((value, index) => bytes[offset + index] === value);
}

function containsAsciiAtEnd(bytes: Uint8Array, value: string): boolean {
  const encoder = new TextEncoder();
  const needle = encoder.encode(value);
  const start = Math.max(0, bytes.byteLength - 2048);
  const haystack = bytes.subarray(start);
  if (needle.byteLength === 0 || haystack.byteLength < needle.byteLength) return false;
  for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    if (needle.every((byte, needleIndex) => haystack[index + needleIndex] === byte)) return true;
  }
  return false;
}

function detectMediaType(bytes: Uint8Array): SupportedAttachmentMediaType | null {
  if (startsWith(bytes, PDF_SIGNATURE) && containsAsciiAtEnd(bytes, '%%EOF')) return 'application/pdf';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff]) && endsWith(bytes, [0xff, 0xd9])) return 'image/jpeg';
  return null;
}

function extensionMatches(fileName: string, mediaType: SupportedAttachmentMediaType): boolean {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  if (mediaType === 'application/pdf') return extension === '.pdf';
  if (mediaType === 'image/png') return extension === '.png';
  return extension === '.jpg' || extension === '.jpeg';
}

function hasUnsafeFileNameCharacter(fileName: string): boolean {
  return Array.from(fileName).some((character) => {
    const codePoint = character.charCodeAt(0);
    return character === '/' || character === '\\' || codePoint <= 31 || codePoint === 127;
  });
}

function invalid(code: Extract<AttachmentValidationResult, { ok: false }>['code'], message: string): AttachmentValidationResult {
  return { ok: false, code, message };
}

export function validateAttachmentUpload(input: AttachmentValidationInput): AttachmentValidationResult {
  if (!Number.isSafeInteger(input.currentCount) || input.currentCount < 0) {
    return invalid('count_exceeded', 'Invalid attachment count.');
  }
  if (input.currentCount >= MAX_ATTACHMENTS_PER_CASE) {
    return invalid('count_exceeded', `A case may contain at most ${MAX_ATTACHMENTS_PER_CASE} attachments.`);
  }
  if (input.bytes.byteLength === 0) {
    return invalid('empty', 'Attachment cannot be empty.');
  }
  if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return invalid('too_large', 'Attachment exceeds the 10 MiB limit.');
  }

  const fileName = input.fileName.normalize('NFC').trim();
  if (
    fileName.length === 0 ||
    fileName.length > MAX_ATTACHMENT_FILENAME_LENGTH ||
    fileName === '.' ||
    fileName === '..' ||
    hasUnsafeFileNameCharacter(fileName)
  ) {
    return invalid('invalid_name', 'Attachment file name is invalid.');
  }

  const mediaType = detectMediaType(input.bytes);
  if (!mediaType) {
    return invalid('unsupported_type', 'Attachment bytes do not match a supported file format.');
  }
  if (!extensionMatches(fileName, mediaType)) {
    return invalid('extension_mismatch', 'Attachment extension does not match its detected file type.');
  }

  return {
    ok: true,
    value: {
      fileName,
      mediaType,
      size: input.bytes.byteLength,
    },
  };
}
