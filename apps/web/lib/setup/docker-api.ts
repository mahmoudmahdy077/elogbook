import http from 'http';

const DOCKER_SOCKET = '/var/run/docker.sock';

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: { PrivatePort: number; PublicPort?: number; Type: string }[];
}

interface DockerImage {
  Id: string;
  RepoTags: string[];
  Size: number;
}

interface DockerNetwork {
  Name: string;
  Driver: string;
  Scope: string;
}

function dockerRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Docker API timeout')); });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

export async function listContainers(all = true): Promise<DockerContainer[]> {
  const containers = await dockerRequest('GET', `/containers/json?all=${all}`) as DockerContainer[];
  return containers;
}

export async function getContainer(name: string): Promise<DockerContainer | null> {
  try {
    const container = await dockerRequest('GET', `/containers/${name}/json`) as DockerContainer;
    return container;
  } catch {
    return null;
  }
}

export async function startContainer(name: string): Promise<void> {
  await dockerRequest('POST', `/containers/${name}/start`);
}

export async function stopContainer(name: string, timeout = 30): Promise<void> {
  await dockerRequest('POST', `/containers/${name}/stop?t=${timeout}`);
}

export async function removeContainer(name: string, force = false): Promise<void> {
  await dockerRequest('DELETE', `/containers/${name}?force=${force}`);
}

export async function pullImage(image: string, onProgress?: (progress: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: DOCKER_SOCKET,
      path: `/images/create?fromImage=${encodeURIComponent(image)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
        const lines = data.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const progress = JSON.parse(line);
            if (progress.status && onProgress) {
              onProgress(progress.status);
            }
          } catch {
            // Not JSON, skip
          }
        }
      });
      res.on('end', resolve);
    });

    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(); reject(new Error('Image pull timeout')); });
    req.end();
  });
}

export async function listImages(): Promise<DockerImage[]> {
  const images = await dockerRequest('GET', '/images/json') as DockerImage[];
  return images;
}

export async function removeImage(image: string): Promise<void> {
  await dockerRequest('DELETE', `/images/${image}?force=true`);
}

export async function listNetworks(): Promise<DockerNetwork[]> {
  const networks = await dockerRequest('GET', '/networks') as DockerNetwork[];
  return networks;
}

export async function networkExists(name: string): Promise<boolean> {
  const networks = await listNetworks();
  return networks.some(n => n.Name === name);
}

export async function dockerInfo(): Promise<Record<string, unknown>> {
  return dockerRequest('GET', '/info') as Promise<Record<string, unknown>>;
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await dockerInfo();
    return true;
  } catch {
    return false;
  }
}
