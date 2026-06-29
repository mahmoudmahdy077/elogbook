import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

describe('mobile i18n locales (P6.2)', () => {
  const localesDir = resolve(__dirname, '../../locales');
  const en = JSON.parse(readFileSync(resolve(localesDir, 'en.json'), 'utf8'));
  const ar = JSON.parse(readFileSync(resolve(localesDir, 'ar.json'), 'utf8'));

  it('en.json is a non-empty object', () => {
    expect(typeof en).toBe('object');
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it('ar.json is a non-empty object', () => {
    expect(typeof ar).toBe('object');
    expect(Object.keys(ar).length).toBeGreaterThan(0);
  });

  it('ar.json mirrors en.json key set', () => {
    const enKeys = new Set(flattenKeys(en));
    const arKeys = new Set(flattenKeys(ar));
    const missing: string[] = [];
    for (const k of enKeys) if (!arKeys.has(k)) missing.push(k);
    expect(missing, `Missing Arabic keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('ar.json has no extra keys that en.json does not', () => {
    const enKeys = new Set(flattenKeys(en));
    const arKeys = new Set(flattenKeys(ar));
    const extra: string[] = [];
    for (const k of arKeys) if (!enKeys.has(k)) extra.push(k);
    expect(extra, `Extra Arabic keys: ${extra.join(', ')}`).toEqual([]);
  });

  it('Arabic values are non-empty strings', () => {
    const values = flattenKeys(ar).map((k) =>
      k.split('.').reduce<unknown>((acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : acc), ar)
    );
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('Arabic profile.logout is "تسجيل الخروج" (sanity check)', () => {
    expect(ar.profile.logout).toBe('تسجيل الخروج');
  });

  it('English profile.logout is "Log out"', () => {
    expect(en.profile.logout).toBe('Log out');
  });
});
