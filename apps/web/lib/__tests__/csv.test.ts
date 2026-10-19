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
  it('neutralizes formula prefixes before CSV quoting', () => {
    expect(escapeCsvCell('=cmd()')).toBe("'=cmd()");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('@x')).toBe("'@x");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('=SUM(1,2)')).toBe("\"'=SUM(1,2)\"");
    expect(escapeCsvCell('"=cmd()"')).toBe("\"'\"\"=cmd()\"\"\"");
  });
  it('neutralizes formulas after leading whitespace and control characters', () => {
    expect(escapeCsvCell(' \t=cmd()')).toBe("' \t=cmd()");
    expect(escapeCsvCell('\u0000=cmd()')).toBe("'\u0000=cmd()");
  });
  it.each([
    ['\tvalue', "'\tvalue"],
    ['\rvalue', "\"'\rvalue\""],
    ['\nvalue', "\"'\nvalue\""],
  ])('neutralizes a value beginning with control whitespace: %j', (value, expected) => {
    expect(escapeCsvCell(value)).toBe(expected);
  });
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('');
  });
});
