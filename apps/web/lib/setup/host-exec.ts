import { execFileSync } from 'child_process';

/**
 * The control plane's only shell-out seam.
 *
 * Uninstall is the single caller. Keeping the `child_process` call behind one
 * named function means the destructive primitive is (a) greppable, (b)
 * mockable in tests without patching a Node builtin, and (c) impossible to
 * reach with a caller-chosen binary or a caller-chosen argument string: only
 * `docker` is permitted and arguments are passed as a vector, never through a
 * shell string.
 *
 * `cwd` is a server-derived, validated absolute install path — never a request
 * field.
 */

const HOST_EXEC_TIMEOUT_MS = 60_000;

export type HostExecOptions = {
  cwd?: string;
};

export function runDocker(args: readonly string[], options: HostExecOptions = {}): void {
  execFileSync('docker', [...args], {
    encoding: 'utf-8',
    timeout: HOST_EXEC_TIMEOUT_MS,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
}
