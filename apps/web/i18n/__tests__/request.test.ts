import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isRtl, locales, defaultLocale } from '../request';

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

describe('i18n locale integrity (P6.2)', () => {
  const messagesDir = resolve(__dirname, '../../messages');
  const en = JSON.parse(readFileSync(resolve(messagesDir, 'en.json'), 'utf8'));
  const ar = JSON.parse(readFileSync(resolve(messagesDir, 'ar.json'), 'utf8'));

  it('exposes en + ar + fr as the supported locales', () => {
    expect(locales).toEqual(['en', 'ar', 'fr']);
  });

  it('defaults to en', () => {
    expect(defaultLocale).toBe('en');
  });

  it('flags ar as RTL', () => {
    expect(isRtl('ar')).toBe(true);
  });

  it('flags en as LTR', () => {
    expect(isRtl('en')).toBe(false);
  });

  it('flags fr as LTR', () => {
    expect(isRtl('fr')).toBe(false);
  });

  it('ar.json has every key from en.json (no missing translations)', () => {
    const enKeys = new Set(flattenKeys(en));
    const arKeys = new Set(flattenKeys(ar));
    const missing: string[] = [];
    for (const k of enKeys) {
      if (!arKeys.has(k)) missing.push(k);
    }
    expect(missing, `Missing Arabic keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('fr.json has every key from en.json (no missing translations)', () => {
    const fr = JSON.parse(readFileSync(resolve(messagesDir, 'fr.json'), 'utf8'));
    const enKeys = new Set(flattenKeys(en));
    const frKeys = new Set(flattenKeys(fr));
    const missing: string[] = [];
    for (const k of enKeys) {
      if (!frKeys.has(k)) missing.push(k);
    }
    expect(missing, `Missing French keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('ar.json has no extra keys that en.json does not', () => {
    const enKeys = new Set(flattenKeys(en));
    const arKeys = new Set(flattenKeys(ar));
    const extra: string[] = [];
    for (const k of arKeys) {
      if (!enKeys.has(k)) extra.push(k);
    }
    expect(extra, `Extra Arabic keys: ${extra.join(', ')}`).toEqual([]);
  });

  it('fr.json has no extra keys that en.json does not', () => {
    const fr = JSON.parse(readFileSync(resolve(messagesDir, 'fr.json'), 'utf8'));
    const enKeys = new Set(flattenKeys(en));
    const frKeys = new Set(flattenKeys(fr));
    const extra: string[] = [];
    for (const k of frKeys) {
      if (!enKeys.has(k)) extra.push(k);
    }
    expect(extra, `Extra French keys: ${extra.join(', ')}`).toEqual([]);
  });

  it('Arabic values are non-empty strings', () => {
    const values = flattenKeys(ar).map((k) => k.split('.').reduce<unknown>((acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : acc), ar));
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    }
  });
});
