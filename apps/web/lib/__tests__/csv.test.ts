import { describe, it, expect } from 'vitest';
import { escapeCsvCell } from '../csv';

describe('escapeCsvCell', () => {
  it('quotes values containing commas', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });
  it('doubles embedded quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('quotes values with newlines', () => {
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });
  it('neutralizes formula prefixes', () => {
    expect(escapeCsvCell('=cmd()')).toBe("'=cmd()");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('@x')).toBe("'@x");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
  });
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('');
  });
});
