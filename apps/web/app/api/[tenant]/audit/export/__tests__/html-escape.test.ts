import { describe, it, expect } from 'vitest';
import { generateAuditHtml } from '../route';

describe('generateAuditHtml', () => {
  it('escapes HTML in audit values', () => {
    const html = generateAuditHtml([{
      id: '<script>alert(1)</script>',
      created_at: '2026-08-12',
      action: 'phi_view',
      resource_type: 'case_entry',
      resource_id: 'x&y',
      user_id: null,
      ip_address: '1.2.3.4',
    }] as never);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('x&amp;y');
  });
});
