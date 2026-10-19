import { describe, expect, it } from 'vitest';
import {
  APPROVED_SCANNER_CONNECTORS,
  getAttachmentScannerReadiness,
} from '../scanner-config';

const readyRow = {
  scanner_enabled: true,
  connector_approved: true,
  scanner_connector_id: 'connector-a',
  scanner_connector_revision: '2026-09-25.1',
  scanner_approval_reference: 'SEC-2026-001',
  scanner_timeout_ms: 30_000,
  max_scan_bytes: 10 * 1024 * 1024,
};

const readyEnv = {
  ATTACHMENT_SCANNER_ENABLED: 'true',
  ATTACHMENT_SCANNER_CONNECTOR_ID: 'connector-a',
  ATTACHMENT_SCANNER_CONNECTOR_REVISION: '2026-09-25.1',
  ATTACHMENT_SCANNER_TIMEOUT_MS: '30000',
  ATTACHMENT_SCANNER_MAX_BYTES: String(10 * 1024 * 1024),
};

describe('getAttachmentScannerReadiness', () => {
  it('accepts only a matching registered connector with reviewed bounds', () => {
    const result = getAttachmentScannerReadiness(
      readyRow,
      readyEnv,
      new Map<string, true>([['connector-a@2026-09-25.1', true]]),
    );

    expect(result).toEqual({ ready: true, code: 'ready' });
  });

  it('keeps production blocked while no connector is registered', () => {
    expect(APPROVED_SCANNER_CONNECTORS.size).toBe(0);
    expect(getAttachmentScannerReadiness(readyRow, readyEnv)).toEqual({
      ready: false,
      code: 'connector_not_registered',
    });
  });

  it('rejects disabled, pending, placeholder, and mismatched configuration', () => {
    const registry = new Map<string, true>([['connector-a@2026-09-25.1', true]]);
    const cases = [
      [{ ...readyRow, scanner_enabled: false }, readyEnv, 'scanner_disabled'],
      [{ ...readyRow, connector_approved: false }, readyEnv, 'connector_not_approved'],
      [{ ...readyRow, scanner_connector_id: 'REPLACE_WITH_CONNECTOR' }, readyEnv, 'connector_not_approved'],
      [{ ...readyRow, scanner_approval_reference: 'pending' }, readyEnv, 'approval_not_recorded'],
      [readyRow, { ...readyEnv, ATTACHMENT_SCANNER_CONNECTOR_REVISION: 'other' }, 'connector_mismatch'],
      [readyRow, { ...readyEnv, ATTACHMENT_SCANNER_TIMEOUT_MS: '50' }, 'timeout_invalid'],
      [readyRow, { ...readyEnv, ATTACHMENT_SCANNER_MAX_BYTES: String(10 * 1024 * 1024 + 1) }, 'limit_invalid'],
    ] as const;

    for (const [row, env, code] of cases) {
      expect(getAttachmentScannerReadiness(row, env, registry)).toEqual({ ready: false, code });
    }
  });
});
