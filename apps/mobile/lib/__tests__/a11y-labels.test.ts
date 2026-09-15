import { describe, it, expect } from 'vitest';
import { auditLabels, offlineStatusCopy } from '../a11y';

describe('a11y M6 (labels + status copy)', () => {
  it('flags missing accessible labels', () => {
    expect(auditLabels([{ id: 'submit', label: 'Submit case' }])).toEqual([]);
    expect(auditLabels([{ id: 'submit', label: '' }])).toEqual(['submit']);
  });

  it('uses resident-understandable offline copy (no jargon)', () => {
    expect(offlineStatusCopy('offline')).toContain('offline');
    expect(offlineStatusCopy('synced')).toContain('saved');
    expect(offlineStatusCopy('offline').toLowerCase()).not.toContain('watermelon');
    expect(offlineStatusCopy('offline').toLowerCase()).not.toContain('supabase');
  });
});
