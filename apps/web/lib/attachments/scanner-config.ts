export const APPROVED_SCANNER_CONNECTORS: ReadonlyMap<string, true> = new Map();

export type AttachmentScannerConfigRow = {
  scanner_enabled?: unknown;
  connector_approved?: unknown;
  scanner_connector_id?: unknown;
  scanner_connector_revision?: unknown;
  scanner_approval_reference?: unknown;
  scanner_timeout_ms?: unknown;
  max_scan_bytes?: unknown;
};

export type AttachmentScannerReadiness = {
  ready: boolean;
  code: string;
};

type ScannerEnvironment = Record<string, string | undefined>;

const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const MIN_SCAN_TIMEOUT_MS = 1_000;
const MAX_SCAN_TIMEOUT_MS = 120_000;
const FORBIDDEN_REVIEW_VALUE = /^(?:pending|replace|replace_with.*|todo|placeholder|example|dummy|unknown|operator|local|test|fixture|changeme)$/i;

function blocked(code: string): AttachmentScannerReadiness {
  return { ready: false, code };
}

function reviewedValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !FORBIDDEN_REVIEW_VALUE.test(value.trim());
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function getAttachmentScannerReadiness(
  row: AttachmentScannerConfigRow | null | undefined,
  env: ScannerEnvironment = process.env,
  registry: ReadonlyMap<string, true> = APPROVED_SCANNER_CONNECTORS,
): AttachmentScannerReadiness {
  if (!row) return blocked('config_unavailable');
  if (row.scanner_enabled !== true || env.ATTACHMENT_SCANNER_ENABLED !== 'true') {
    return blocked('scanner_disabled');
  }
  if (row.connector_approved !== true) return blocked('connector_not_approved');
  if (!reviewedValue(row.scanner_connector_id)) return blocked('connector_not_approved');
  if (!reviewedValue(row.scanner_connector_revision)) return blocked('connector_not_approved');
  if (!reviewedValue(row.scanner_approval_reference)) return blocked('approval_not_recorded');

  const connectorId = row.scanner_connector_id.trim();
  const connectorRevision = row.scanner_connector_revision.trim();
  if (
    env.ATTACHMENT_SCANNER_CONNECTOR_ID?.trim() !== connectorId
    || env.ATTACHMENT_SCANNER_CONNECTOR_REVISION?.trim() !== connectorRevision
  ) {
    return blocked('connector_mismatch');
  }

  const timeout = boundedInteger(env.ATTACHMENT_SCANNER_TIMEOUT_MS, MIN_SCAN_TIMEOUT_MS, MAX_SCAN_TIMEOUT_MS);
  if (timeout === null || timeout !== row.scanner_timeout_ms) return blocked('timeout_invalid');

  const maxBytes = boundedInteger(env.ATTACHMENT_SCANNER_MAX_BYTES, 1, MAX_SCAN_BYTES);
  if (maxBytes === null || maxBytes !== row.max_scan_bytes) return blocked('limit_invalid');

  if (!registry.has(`${connectorId}@${connectorRevision}`)) return blocked('connector_not_registered');
  return { ready: true, code: 'ready' };
}
