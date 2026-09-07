import { describe, it, expect } from 'vitest';
import { parseBranding, brandingCssVars } from '../tenant-branding';

// T21/F11: saved white-label settings must reach the tenant shell on
// initial server render. Only validated values apply; anything hostile
// or malformed falls back to platform defaults (never raw JSON in CSS).
describe('parseBranding (T21)', () => {
  it('accepts a complete valid branding record', () => {
    const b = parseBranding({
      logo_url: 'https://cdn.example.com/logo.png',
      primary_color: '#0A84FF',
      footer_text: 'City Hospital',
      institution_name: 'City Hospital',
    });
    expect(b.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(b.primaryColor).toBe('#0A84FF');
    expect(b.footerText).toBe('City Hospital');
  });

  it('rejects non-https logos and non-hex colors, bounds oversized text', () => {
    const b = parseBranding({
      logo_url: 'http://evil.example.com/logo.png',
      primary_color: 'red',
      footer_text: 'x'.repeat(500),
      institution_name: 'y'.repeat(500),
    });
    expect(b.logoUrl).toBeNull();
    expect(b.primaryColor).toBeNull();
    expect(b.footerText).toBe('x'.repeat(160));
    expect(b.institutionName).toBe('y'.repeat(160));
  });

  it('neutralizes CSS/HTML injection attempts', () => {
    const b = parseBranding({
      logo_url: 'javascript:alert(1)',
      primary_color: '#007AFF";}body{background:red',
      footer_text: '<img src=x onerror=alert(1)>',
    });
    expect(b.logoUrl).toBeNull();
    expect(b.primaryColor).toBeNull();
    // Footer text is rendered as text, but bounding length still applies.
    expect(b.footerText).toBe('<img src=x onerror=alert(1)>'.slice(0, 160));
    expect(JSON.stringify(brandingCssVars(b))).not.toContain('</style>');
  });

  it('treats null/garbage records as defaults', () => {
    for (const bad of [null, undefined, 42, 'brand', [], { logo_url: {} }]) {
      const b = parseBranding(bad);
      expect(b).toEqual({ logoUrl: null, primaryColor: null, footerText: '', institutionName: '' });
    }
  });
});

describe('brandingCssVars (T21)', () => {
  it('emits only validated primary overrides', () => {
    expect(brandingCssVars(parseBranding({ primary_color: '#0A84FF' }))).toEqual({
      '--color-primary': '#0A84FF',
    });
    expect(brandingCssVars(parseBranding({}))).toEqual({});
  });
});
