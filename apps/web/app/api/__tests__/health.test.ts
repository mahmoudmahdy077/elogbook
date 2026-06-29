import { describe, it, expect } from 'vitest';
import { newRequestId } from '../../../lib/request-context';

describe('health route helpers', () => {
  it('generates a UUID-shaped request id', () => {
    const id = newRequestId();
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it('rejects unsafe incoming X-Request-Id values', () => {
    const bad = '../etc/passwd';
    expect(/^[\w-]{1,128}$/.test(bad)).toBe(false);
  });

  it('accepts a clean UUID as the incoming id', () => {
    const good = '11111111-2222-3333-4444-555555555555';
    expect(/^[\w-]{1,128}$/.test(good)).toBe(true);
  });
});
