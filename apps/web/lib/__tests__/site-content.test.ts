import { describe, it, expect } from 'vitest';
import { validatePageContent } from '../site-content';

// T24: structured blocks only — no arbitrary HTML/MDX execution, safe
// links, bounded size/depth. The renderer (T25) maps types to components.
describe('validatePageContent (T24)', () => {
  const hero = { type: 'hero', heading: 'Welcome', subheading: 'Hi', cta: { label: 'Start', href: '/signup' } };

  it('accepts a well-formed page', () => {
    const res = validatePageContent({
      blocks: [
        hero,
        { type: 'faq', items: [{ q: 'Q?', a: 'A.' }] },
        { type: 'contact', email: 'hello@example.com' },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('rejects unknown block types and missing required fields', () => {
    const res = validatePageContent({ blocks: [{ type: 'carousel' }, { type: 'hero' }] });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/carousel/);
    expect(res.errors.join(' ')).toMatch(/heading/);
  });

  it('rejects script URLs, unsafe embeds, and non-http links', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<h1>x</h1>', 'ftp://x/y', '']) {
      const res = validatePageContent({ blocks: [{ ...hero, cta: { label: 'x', href } }] });
      expect(res.ok, href).toBe(false);
    }
    expect(validatePageContent({ blocks: [{ ...hero, cta: { label: 'x', href: '/pricing' } }] }).ok).toBe(true);
    expect(validatePageContent({ blocks: [{ ...hero, cta: { label: 'x', href: 'mailto:a@b.c' } }] }).ok).toBe(true);
  });

  it('rejects oversized and over-deep content', () => {
    const many = Array.from({ length: 65 }, (_, i) => ({ type: 'text', body: `p${i}` }));
    expect(validatePageContent({ blocks: many }).ok).toBe(false);
    const deep = { type: 'text', body: 'x', children: [] as unknown[] };
    let node: Record<string, unknown> = deep;
    for (let i = 0; i < 6; i++) {
      const child: Record<string, unknown> = { type: 'text', body: 'x', children: [] };
      (node.children as unknown[]).push(child);
      node = child;
    }
    expect(validatePageContent({ blocks: [deep] }).ok).toBe(false);
  });

  it('rejects non-object content and oversized JSON', () => {
    expect(validatePageContent(null).ok).toBe(false);
    expect(validatePageContent({ blocks: 'nope' }).ok).toBe(false);
    const big = { type: 'text', body: 'x'.repeat(200 * 1024) };
    expect(validatePageContent({ blocks: [big] }).ok).toBe(false);
  });

  it('rejects raw HTML fields where text is expected', () => {
    const res = validatePageContent({
      blocks: [{ type: 'text', body: '<script>alert(1)</script>' }],
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/html/i);
  });
});
