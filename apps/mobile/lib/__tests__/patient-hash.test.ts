import { describe, it, expect, vi } from 'vitest';

// expo-crypto is a native module; stub it so the test runs under vitest's
// node environment. The stub delegates to the Web Crypto API which is
// available in modern Node and produces the same SHA-256 hex output the
// real native module would on-device.
vi.mock('expo-crypto', async () => {
  const { webcrypto } = await import('node:crypto');
  const hexFromBytes = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digestStringAsync = async (
    algorithm: string,
    input: string,
  ): Promise<string> => {
    const algoName = algorithm === 'SHA256' ? 'SHA-256' : algorithm;
    const bytes = new TextEncoder().encode(input);
    const digest = await webcrypto.subtle.digest(algoName, bytes);
    return hexFromBytes(new Uint8Array(digest));
  };
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync,
  };
});

import { generatePatientHash } from '../patient-hash';

describe('generatePatientHash', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', async () => {
    const hash = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    const b = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    expect(a).toBe(b);
  });

  it('matches a manually-computed SHA-256 over "${tenantId}:${mrn}:${dob}"', async () => {
    const { webcrypto } = await import('node:crypto');
    const expected = await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('tenant-1:mrn-123:1990-01-01'),
    );
    const expectedHex = Array.from(new Uint8Array(expected), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const actual = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    expect(actual).toBe(expectedHex);
  });

  it('produces a different hash for a different tenant', async () => {
    const a = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    const b = await generatePatientHash('tenant-2', 'mrn-123', '1990-01-01');
    expect(a).not.toBe(b);
  });

  it('produces a different hash when mrn changes', async () => {
    const a = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    const b = await generatePatientHash('tenant-1', 'mrn-456', '1990-01-01');
    expect(a).not.toBe(b);
  });

  it('produces a different hash when dob changes', async () => {
    const a = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-01');
    const b = await generatePatientHash('tenant-1', 'mrn-123', '1990-01-02');
    expect(a).not.toBe(b);
  });

  it('handles empty mrn/dob for the de-identified path', async () => {
    const hash = await generatePatientHash('tenant-1', 'age-42', '');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const again = await generatePatientHash('tenant-1', 'age-42', '');
    expect(again).toBe(hash);
  });
});
