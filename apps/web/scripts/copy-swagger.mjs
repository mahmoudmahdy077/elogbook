// Copy self-hosted Swagger UI assets into public/ so /api-docs works under a
// strict CSP (script-src 'strict-dynamic' forbids CDN scripts; style-src
// forbids unpkg). Runs before `next build` via the web package's build script.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outDir = join(webRoot, 'public', 'swagger');
mkdirSync(outDir, { recursive: true });

let dist;
try {
  // swagger-ui-dist ships browser bundles at its package root
  const pkgPath = require.resolve('swagger-ui-dist/swagger-ui-bundle.js');
  dist = dirname(pkgPath);
} catch {
  console.error('[copy-swagger] swagger-ui-dist not installed');
  process.exit(1);
}

for (const f of ['swagger-ui-bundle.js', 'swagger-ui.css']) {
  copyFileSync(join(dist, f), join(outDir, f));
  console.log('[copy-swagger]', f);
}
