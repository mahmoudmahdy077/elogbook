import { describe, it, expect } from 'vitest';
import { makeProfile, makeCaseEntry } from '../fixtures';

describe('shared fixtures', () => {
  it('makeProfile returns valid defaults', () => {
    const p = makeProfile();
    expect(p.id).toBeTruthy();
    expect(p.role).toBe('resident');
  });

  it('makeProfile accepts overrides', () => {
    const p = makeProfile({ role: 'director' });
    expect(p.role).toBe('director');
  });

  it('makeCaseEntry returns valid defaults', () => {
    const c = makeCaseEntry();
    expect(c.status).toBe('draft');
    expect(c.tenant_id).toBeTruthy();
  });
});
