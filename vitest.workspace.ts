import { defineWorkspace } from 'vitest/config';

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
