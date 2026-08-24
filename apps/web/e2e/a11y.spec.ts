import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('a11y scan', () => {
  const pages = ['/', '/login', '/signup', '/pricing'];
  for (const path of pages) {
    test(`${path} has no critical a11y violations`, async ({ page: p }) => {
      await p.goto(path);
      const results = await new AxeBuilder({ page: p }).analyze();
      const critical = results.violations.filter((v) => v.impact === 'critical');
      // Log non-critical issues for triage without failing the build
      const minor = results.violations.filter((v) => v.impact !== 'critical');
      if (minor.length > 0) {
        console.log(`[a11y] ${path}: ${minor.length} non-critical violation kinds`);
      }
      expect(critical, JSON.stringify(critical.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toHaveLength(0);
    });
  }
});
