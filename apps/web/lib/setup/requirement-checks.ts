import { execSync } from 'child_process';

export interface RequirementCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  installed_version?: string;
  required_version?: string;
}

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function checkDocker(): RequirementCheck {
  const version = runCommand('docker --version');
  if (!version) {
    return { name: 'Docker', status: 'fail', message: 'Docker is not installed. Install from https://docs.docker.com/get-docker/' };
  }
  const match = version.match(/Docker version (\d+\.\d+\.\d+)/);
  const ver = match?.[1] || version;
  return { name: 'Docker', status: 'pass', message: `Docker ${ver} installed`, installed_version: ver, required_version: '24.0+' };
}

function checkDockerCompose(): RequirementCheck {
  const version = runCommand('docker compose version');
  if (!version) {
    return { name: 'Docker Compose', status: 'fail', message: 'Docker Compose v2 is not available. Update Docker to latest version.' };
  }
  const match = version.match(/version (\d+\.\d+\.\d+)/);
  const ver = match?.[1] || version;
  return { name: 'Docker Compose', status: 'pass', message: `Docker Compose ${ver} installed`, installed_version: ver, required_version: 'v2.20+' };
}

function checkDiskSpace(): RequirementCheck {
  try {
    const output = runCommand("df -BG /var/lib/docker 2>/dev/null | tail -1 | awk '{print $4}'");
    const freeGB = parseInt(output, 10);
    if (isNaN(freeGB)) {
      return { name: 'Disk Space', status: 'warn', message: 'Could not check disk space' };
    }
    if (freeGB < 5) {
      return { name: 'Disk Space', status: 'fail', message: `${freeGB}GB free. At least 5GB required.` };
    }
    return { name: 'Disk Space', status: 'pass', message: `${freeGB}GB free`, installed_version: `${freeGB}GB`, required_version: '5GB+' };
  } catch {
    return { name: 'Disk Space', status: 'warn', message: 'Could not check disk space' };
  }
}

function checkRAM(): RequirementCheck {
  try {
    const output = runCommand("free -m 2>/dev/null | awk '/Mem:/ {print $7}'");
    const freeMB = parseInt(output, 10);
    if (isNaN(freeMB)) {
      return { name: 'RAM', status: 'warn', message: 'Could not check available RAM' };
    }
    if (freeMB < 2048) {
      return { name: 'RAM', status: 'fail', message: `${freeMB}MB available. At least 2GB required.` };
    }
    return { name: 'RAM', status: 'pass', message: `${Math.round(freeMB / 1024)}GB available`, installed_version: `${Math.round(freeMB / 1024)}GB`, required_version: '2GB+' };
  } catch {
    return { name: 'RAM', status: 'warn', message: 'Could not check available RAM' };
  }
}

function checkPort(port: number): RequirementCheck {
  const output = runCommand(`ss -tlnp 2>/dev/null | grep :${port} || netstat -tlnp 2>/dev/null | grep :${port} || echo ""`);
  if (output) {
    return { name: `Port ${port}`, status: 'fail', message: `Port ${port} is already in use` };
  }
  return { name: `Port ${port}`, status: 'pass', message: `Port ${port} is available` };
}

export async function checkAllRequirements(): Promise<RequirementCheck[]> {
  const checks: RequirementCheck[] = [
    checkDocker(),
    checkDockerCompose(),
    checkDiskSpace(),
    checkRAM(),
    checkPort(80),
    checkPort(443),
    checkPort(3000),
  ];
  return checks;
}

export function getFailedChecks(checks: RequirementCheck[]): RequirementCheck[] {
  return checks.filter(c => c.status === 'fail');
}

export function allPassed(checks: RequirementCheck[]): boolean {
  return checks.every(c => c.status === 'pass' || c.status === 'warn');
}
