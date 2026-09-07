import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SitePageRenderer from '../SitePageRenderer';

// T25: the renderer maps typed blocks to escaped JSX. No raw HTML may
// reach the DOM; unknown types degrade to a fallback, never a crash.
describe('SitePageRenderer (T25)', () => {
  it('renders headings, text, and safe links', () => {
    const html = renderToStaticMarkup(
      <SitePageRenderer
        blocks={[
          { type: 'hero', heading: 'Welcome', subheading: 'Hi', cta: { label: 'Start', href: '/signup' } },
          { type: 'text', body: 'Plain paragraph.' },
        ]}
      />,
    );
    expect(html).toContain('Welcome');
    expect(html).toContain('Plain paragraph.');
    expect(html).toContain('href="/signup"');
  });

  it('escapes text instead of executing markup', () => {
    const html = renderToStaticMarkup(
      <SitePageRenderer blocks={[{ type: 'text', body: '<script>alert(1)</script>' }]} />,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('strips unsafe link targets to inert text', () => {
    const html = renderToStaticMarkup(
      <SitePageRenderer blocks={[{ type: 'cta', label: 'Click', href: 'javascript:alert(1)' }]} />,
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Click');
  });

  it('renders unknown block types as a fallback without crashing', () => {
    const html = renderToStaticMarkup(<SitePageRenderer blocks={[{ type: 'carousel' }]} />);
    expect(html).toContain('Unsupported content block');
  });

  it('renders faq items and contact mailto links', () => {
    const html = renderToStaticMarkup(
      <SitePageRenderer
        blocks={[
          { type: 'faq', items: [{ q: 'Q?', a: 'A.' }] },
          { type: 'contact', heading: 'Talk', email: 'hello@example.com' },
        ]}
      />,
    );
    expect(html).toContain('Q?');
    expect(html).toContain('mailto:hello@example.com');
  });
});
