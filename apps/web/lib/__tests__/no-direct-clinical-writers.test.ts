import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..', '..');
const routes = [
  'apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts',
  'apps/web/app/(authenticated)/[tenant]/cases/[id]/request-verification/route.ts',
];

describe('clinical writers', () => {
  it.each(routes)('%s is not a production route', (route) => {
    expect(existsSync(resolve(root, route))).toBe(false);
  });
});
