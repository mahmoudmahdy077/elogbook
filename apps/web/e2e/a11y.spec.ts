import { test, expect } from '@playwright/test';
test.describe('a11y scan', () => {
  const pages = ['/', '/login', '/signup', '/pricing'];
  for (const page of pages) {
    test(`${page} has no critical a11y violations`, async ({ page: p }) => {
      await p.goto(page);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- axe matcher ships no type defs
      await (expect(p) as any).toPassAxe({} as any);
    });
  }
});
