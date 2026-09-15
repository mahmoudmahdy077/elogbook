import { defineWorkspace } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';

export default defineWorkspace([
  {
    extends: './packages/shared/vitest.config.mts',
    test: {
      name: 'shared',
      root: './packages/shared',
    },
  },
  {
    extends: './apps/web/vitest.config.mts',
    plugins: [tsconfigPaths({ root: path.resolve(__dirname, './apps/web') })],
    test: {
      name: 'web',
      root: './apps/web',
    },
  },
  {
    extends: './apps/mobile/vitest.config.mts',
    test: {
      name: 'mobile',
      root: './apps/mobile',
    },
  },
]);
