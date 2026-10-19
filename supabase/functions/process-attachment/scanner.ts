export type ScannerEnvironment = Record<string, string | undefined>;

export type ScannerConfiguration = {
  scannerEnabled: boolean;
  connectorApproved: boolean;
  connectorId: string;
  connectorRevision: string;
  approvalReference: string;
  timeoutMs: number;
  maxBytes: number;
};

export type ScanOutcome =
  | { status: 'pending'; code: string }
  | { status: 'no-threat'; code: string }
  | { status: 'infected'; code: string };

export interface ApprovedScannerConnector {
  scan(bytes: Uint8Array, signal: AbortSignal): Promise<'no-threat' | 'infected'>;
}

export const APPROVED_SCANNER_CONNECTORS: ReadonlyMap<string, ApprovedScannerConnector> = new Map();

const FORBIDDEN_REVIEW_VALUE = /^(?:pending|replace|replace_with.*|todo|placeholder|example|dummy|unknown|operator|local|test|fixture|changeme)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

function reviewed(value: string | null | undefined): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !FORBIDDEN_REVIEW_VALUE.test(value.trim());
}

function integer(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function resolveScannerConnector(
  config: Record<string, unknown>,
  env: ScannerEnvironment,
  registry: ReadonlyMap<string, ApprovedScannerConnector> = APPROVED_SCANNER_CONNECTORS,
): { connector?: ApprovedScannerConnector; timeoutMs: number; maxBytes: number; code: string } {
  const connectorId = typeof config.scanner_connector_id === 'string' ? config.scanner_connector_id.trim() : '';
  const connectorRevision = typeof config.scanner_connector_revision === 'string' ? config.scanner_connector_revision.trim() : '';
  const approvalReference = typeof config.scanner_approval_reference === 'string' ? config.scanner_approval_reference.trim() : '';
  const timeoutMs = integer(env.ATTACHMENT_SCANNER_TIMEOUT_MS);
  const maxBytes = integer(env.ATTACHMENT_SCANNER_MAX_BYTES);

  if (env.ATTACHMENT_SCANNER_ENABLED !== 'true' || config.scanner_enabled !== true) {
    return { timeoutMs: 0, maxBytes: 0, code: 'scanner_disabled' };
  }
  if (config.connector_approved !== true || !reviewed(connectorId) || !reviewed(connectorRevision)) {
    return { timeoutMs: 0, maxBytes: 0, code: 'connector_not_approved' };
  }
  if (!reviewed(approvalReference)) {
    return { timeoutMs: 0, maxBytes: 0, code: 'approval_not_recorded' };
  }
  if (
    env.ATTACHMENT_SCANNER_CONNECTOR_ID?.trim() !== connectorId
    || env.ATTACHMENT_SCANNER_CONNECTOR_REVISION?.trim() !== connectorRevision
  ) {
    return { timeoutMs: 0, maxBytes: 0, code: 'connector_mismatch' };
  }
  if (
    timeoutMs === null
    || maxBytes === null
    || timeoutMs < MIN_TIMEOUT_MS
    || timeoutMs > MAX_TIMEOUT_MS
    || timeoutMs !== config.scanner_timeout_ms
    || maxBytes < 1
    || maxBytes > MAX_BYTES
    || maxBytes !== config.max_scan_bytes
  ) {
    return { timeoutMs: 0, maxBytes: 0, code: 'configuration_invalid' };
  }

  const connector = registry.get(`${connectorId}@${connectorRevision}`);
  if (!connector) return { timeoutMs, maxBytes, code: 'connector_not_registered' };
  return { connector, timeoutMs, maxBytes, code: 'ready' };
}

export async function runBoundedScan(
  connector: ApprovedScannerConnector,
  bytes: Uint8Array,
  maxBytes: number,
  timeoutMs: number,
): Promise<ScanOutcome> {
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    return { status: 'pending', code: 'file_limit_exceeded' };
  }

  try {
    const result = await connector.scan(bytes, AbortSignal.timeout(timeoutMs));
    if (result === 'infected') return { status: 'infected', code: 'threat_detected' };
    if (result === 'no-threat') return { status: 'no-threat', code: 'scanner_verified' };
    return { status: 'pending', code: 'invalid_scanner_result' };
  } catch {
    return { status: 'pending', code: 'scanner_timeout_or_error' };
  }
}
