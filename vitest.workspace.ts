import { defineWorkspace } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

export default defineWorkspace([
  {
    extends: './packages/shared/vitest.config.ts',
    test: {
      name: 'shared',
      root: './packages/shared',
    },
  },
  {
    extends: './apps/web/vitest.config.ts',
    plugins: [tsconfigPaths({ root: path.resolve(__dirname, './apps/web') })],
    test: {
      name: 'web',
      root: './apps/web',
    },
  },
  {
    extends: './apps/mobile/vitest.config.ts',
    test: {
      name: 'mobile',
      root: './apps/mobile',
    },
  },
]);
