import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Load the monorepo root env so E2E fixtures can reach NEXT_PUBLIC_SUPABASE_URL
// (zero-dep parser — dotenv isn't a dependency of this package).
// NOTE: this config is loaded as an ES module — use import.meta.url, not __dirname
// (a swallowed ReferenceError here silently disabled all auth seeding once before).
const configDir = fileURLToPath(new globalThis.URL('.', import.meta.url));
for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(configDir + `../../${envFile}`, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // env file missing — try the next one; fixtures fall back to the localStorage stub
  }
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
