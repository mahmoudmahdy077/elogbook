function firstSignificantCharacter(value: string): string {
  let index = 0;
  while (index < value.length) {
    const character = value[index] as string;
    const code = value.charCodeAt(index);
    const ignorable = code <= 0x1f || code === 0x7f || /\s/u.test(character) || character === '"';
    if (!ignorable) return character;
    index += 1;
  }
  return '';
}

function startsWithControlWhitespace(value: string): boolean {
  const code = value.charCodeAt(0);
  return code === 0x09 || code === 0x0a || code === 0x0d;
}

export function escapeCsvCell(v: unknown): string {
  const raw = v === null || v === undefined ? '' : String(v);
  const firstSignificant = firstSignificantCharacter(raw);
  const s = startsWithControlWhitespace(raw) || /^[=+\-@]/.test(firstSignificant)
    ? `'${raw}`
    : raw;
  if (s.includes(',') || s.includes('"') || s.includes('\r') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
