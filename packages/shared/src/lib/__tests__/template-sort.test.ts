import { describe, it, expect } from 'vitest';
import { sortTemplates } from '../template-sort';
import type { CaseTemplate } from '../../types/database';

const tpl = (id: string, name: string): CaseTemplate => ({
  id,
  tenant_id: 't-1',
  specialty: 'Surgery',
  name,
  fields: [],
  required_fields: [],
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  deleted_at: null,
});

describe('sortTemplates', () => {
  const templates = [
    tpl('a', 'Alpha'),
    tpl('b', 'Beta'),
    tpl('c', 'Charlie'),
    tpl('d', 'Delta'),
  ];

  it('places favorites first', () => {
    const result = sortTemplates(templates, new Set(['b', 'a']), new Map(), new Map());
    const ids = result.map((t) => t.id);
    expect(ids.slice(0, 2).sort()).toEqual(['a', 'b']);
    expect(ids.slice(2)).toEqual(['c', 'd']);
  });

  it('sorts non-favorites by personal usage desc', () => {
    const personal = new Map([['a', 5], ['c', 3]]);
    const result = sortTemplates(templates, new Set(), personal, new Map());
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c');
    expect(result[2].id).toBe('b');
    expect(result[3].id).toBe('d');
  });

  it('sorts by tenant usage when personal usage is tied', () => {
    const tenant = new Map([['c', 10], ['a', 5]]);
    const result = sortTemplates(templates, new Set(), new Map(), tenant);
    expect(result[0].id).toBe('c');
    expect(result[1].id).toBe('a');
  });

  it('falls back to alphabetical when all counts are zero', () => {
    const result = sortTemplates(templates, new Set(), new Map(), new Map());
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns empty array for empty templates', () => {
    const result = sortTemplates([], new Set(), new Map(), new Map());
    expect(result).toEqual([]);
  });

  it('sets is_favorite and usage_count on each item', () => {
    const personal = new Map([['a', 3]]);
    const result = sortTemplates(templates, new Set(['a']), personal, new Map());
    expect(result[0].is_favorite).toBe(true);
    expect(result[0].usage_count).toBe(3);
    expect(result[1].is_favorite).toBe(false);
    expect(result[1].usage_count).toBe(0);
  });
});
