import { describe, it, expect } from 'vitest';
import {
  REFLECTION_TYPES,
  reflectionCreateSchema,
  reflectionUpdateSchema,
} from '../reflections';

describe('reflectionCreateSchema', () => {
  it('accepts a valid reflection', () => {
    const result = reflectionCreateSchema.safeParse({
      title: 'Difficult fracture reduction',
      reflection_type: 'clinical',
      body: 'What went well: closed reduction succeeded on the second attempt.',
      shared: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title and body', () => {
    const result = reflectionCreateSchema.safeParse({
      title: '',
      reflection_type: 'clinical',
      body: '',
      shared: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown reflection types', () => {
    const result = reflectionCreateSchema.safeParse({
      title: 't',
      reflection_type: 'nonsense',
      body: 'b',
      shared: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects bodies over 10000 characters', () => {
    const result = reflectionCreateSchema.safeParse({
      title: 't',
      reflection_type: 'clinical',
      body: 'a'.repeat(10001),
      shared: false,
    });
    expect(result.success).toBe(false);
  });

  it('exposes all six reflection categories', () => {
    expect(REFLECTION_TYPES).toEqual([
      'clinical',
      'procedural',
      'communication',
      'teamwork',
      'ethics',
      'other',
    ]);
  });
});

describe('reflectionUpdateSchema', () => {
  it('accepts partial updates', () => {
    const result = reflectionUpdateSchema.safeParse({ shared: true });
    expect(result.success).toBe(true);
  });

  it('still validates provided fields', () => {
    const result = reflectionUpdateSchema.safeParse({ body: '' });
    expect(result.success).toBe(false);
  });
});
