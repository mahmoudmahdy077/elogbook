import { describe, it, expect } from 'vitest';
import { safeRelativePath } from '../safe-redirect';

describe('safeRelativePath', () => {
  it('allows a single-leading-slash relative path', () => {
    expect(safeRelativePath('/dashboard')).toBe('/dashboard');
  });
  it('strips a protocol-relative URL', () => {
    expect(safeRelativePath('//evil.com/x')).toBe('/');
  });
  it('strips an absolute URL', () => {
    expect(safeRelativePath('https://evil.com/x')).toBe('/');
  });
  it('strips a backslash-relative URL', () => {
    expect(safeRelativePath('/\\evil.com')).toBe('/');
  });
  it('defaults to / when input is empty', () => {
    expect(safeRelativePath('')).toBe('/');
  });
  it('defaults to / when input is null', () => {
    expect(safeRelativePath(null)).toBe('/');
  });
  it('defaults to / when input is undefined', () => {
    expect(safeRelativePath(undefined)).toBe('/');
  });
  it('preserves query and hash on relative paths', () => {
    expect(safeRelativePath('/cases?x=1#y')).toBe('/cases?x=1#y');
  });
  it('rejects a path that does not start with a slash', () => {
    expect(safeRelativePath('dashboard')).toBe('/');
  });
  it('rejects a path that looks like a windows UNC path', () => {
    expect(safeRelativePath('\\\\evil.com')).toBe('/');
  });
  it.each([
    '/%2f%2fevil.com/x',
    '/%2F%2Fevil.com/x',
    '/%5c%5cevil.com/x',
    '/%64ashboard',
    '/%2e%2e/evil',
  ])('rejects an encoded or traversal destination: %s', (value) => {
    expect(safeRelativePath(value)).toBe('/');
  });
  it('rejects javascript destinations, including encoded schemes', () => {
    expect(safeRelativePath('javascript:alert(1)')).toBe('/');
    expect(safeRelativePath('/%6a%61vascript:alert(1)')).toBe('/');
  });
  it('rejects a non-allowlisted internal destination', () => {
    expect(safeRelativePath('/not-an-allowed-route')).toBe('/');
  });
});
