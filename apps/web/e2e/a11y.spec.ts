import { test, expect } from '@playwright/test';
test.describe('a11y scan', () => {
  const pages = ['/', '/login', '/signup', '/pricing'];
  for (const page of pages) {
    test(`${page} has no critical a11y violations`, async ({ page: p }) => {
      await p.goto(page);
      await expect(p).toPassAxe();
    });
  }
});
