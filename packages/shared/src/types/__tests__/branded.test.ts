import { describe, it, expect } from 'vitest';
import { isUUID, toUUID } from '../branded';

describe('isUUID', () => {
  it('accepts a v4 UUID', () => {
    expect(isUUID('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isUUID('00000000-0000-0000-0000-000000000000')).toBe(true);
  });
  it('rejects non-UUID strings', () => {
    expect(isUUID('not-a-uuid')).toBe(false);
    expect(isUUID('12345')).toBe(false);
    expect(isUUID('')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isUUID(null)).toBe(false);
    expect(isUUID(undefined)).toBe(false);
    expect(isUUID(123)).toBe(false);
    expect(isUUID({})).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(isUUID('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });
});

describe('toUUID', () => {
  it('returns UUID for valid string', () => {
    expect(toUUID('11111111-2222-3333-4444-555555555555')).toBe('11111111-2222-3333-4444-555555555555');
  });
  it('returns null for invalid', () => {
    expect(toUUID('not-a-uuid')).toBeNull();
  });
});
