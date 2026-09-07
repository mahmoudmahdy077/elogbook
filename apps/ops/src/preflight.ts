/**
 * Provisioning preflight (T11).
 *
 * Pure evaluation over caller-supplied facts: unknown is a failure, never
 * a pass. Host probing (disk/ports/registry I/O) belongs to the executor
 * (T11-full); this module decides honestly from measurements.
 */

export interface PreflightInputs {
  /** Required env keys -> observed values (empty/missing fails). */
  requiredEnv: Record<string, string | undefined>;
  freeDiskBytes: number;
  requiredDiskBytes: number;
  totalRamBytes: number;
  requiredRamBytes: number;
  cpuCount: number;
  requiredCpus: number;
  ports: { port: number; free: boolean }[];
  registryReachable: boolean;
}

export interface PreflightResult {
  pass: boolean;
  failures: string[];
  warnings: string[];
}

function fmtGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export function runPreflight(inputs: PreflightInputs): PreflightResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(inputs.requiredEnv)) {
    if (!value) failures.push(`missing required env: ${key}`);
  }
  if (!(inputs.freeDiskBytes >= inputs.requiredDiskBytes)) {
    failures.push(
      `insufficient disk: free ${fmtGB(inputs.freeDiskBytes)} < required ${fmtGB(inputs.requiredDiskBytes)}`,
    );
  }
  if (!(inputs.totalRamBytes >= inputs.requiredRamBytes)) {
    failures.push(
      `insufficient memory: total ${fmtGB(inputs.totalRamBytes)} < required ${fmtGB(inputs.requiredRamBytes)}`,
    );
  }
  if (!(inputs.cpuCount >= inputs.requiredCpus)) {
    failures.push(`insufficient CPU: ${inputs.cpuCount} < required ${inputs.requiredCpus}`);
  }
  for (const p of inputs.ports) {
    if (!p.free) failures.push(`required port ${p.port} is already in use`);
  }
  if (!inputs.registryReachable) {
    failures.push('container registry unreachable: pinned images cannot be fetched');
  }
  if (inputs.freeDiskBytes < inputs.requiredDiskBytes * 1.5) {
    warnings.push('disk headroom below 1.5x requirement: restores and image pulls may contend');
  }

  return { pass: failures.length === 0, failures, warnings };
}
