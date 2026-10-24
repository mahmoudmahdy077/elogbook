import { describe, it, expect } from 'vitest';
import {
  validateReflectionDraft,
  buildReflectionPayload,
  canDeleteReflection,
  isLeadershipRole,
  countWords,
  REFLECTION_CHIP_OPTIONS,
} from '../reflection-payload';

const PROFILE = { id: '11111111-1111-1111-1111-111111111111', tenant_id: '22222222-2222-2222-2222-222222222222' };
const DRAFT = {
  title: 'Refl on lap chole',
  reflection_type: 'procedural',
  body: 'I should have asked for help sooner.',
  shared: false,
};

describe('validateReflectionDraft', () => {
  it('accepts a valid draft', () => {
    expect(validateReflectionDraft(DRAFT)).toBeNull();
  });

  it('rejects an empty or whitespace-only title', () => {
    expect(validateReflectionDraft({ ...DRAFT, title: '' })).toBe('Title is required');
    expect(validateReflectionDraft({ ...DRAFT, title: '   ' })).toBe('Title is required');
  });

  it('rejects a title over 200 chars', () => {
    expect(validateReflectionDraft({ ...DRAFT, title: 'a'.repeat(201) })).toContain('200');
  });

  it('rejects unknown categories', () => {
    expect(validateReflectionDraft({ ...DRAFT, reflection_type: 'procedure' })).toBe(
      'Choose a reflection category'
    );
  });

  it('rejects an empty body and a body over 10,000 chars', () => {
    expect(validateReflectionDraft({ ...DRAFT, body: '' })).toBe('Reflection body is required');
    expect(validateReflectionDraft({ ...DRAFT, body: 'a'.repeat(10001) })).toContain('10,000');
  });
});

describe('buildReflectionPayload', () => {
  it('builds a tenant/author-scoped insert with trimmed fields', () => {
    const payload = buildReflectionPayload(PROFILE, { ...DRAFT, title: '  tit  ', body: ' b ' });
    expect(payload).toEqual({
      tenant_id: PROFILE.tenant_id,
      author_id: PROFILE.id,
      title: 'tit',
      reflection_type: 'procedural',
      body: 'b',
      case_id: null,
      prompt: null,
      shared: false,
    });
  });

  it('keeps the shared flag opt-in', () => {
    expect(buildReflectionPayload(PROFILE, { ...DRAFT, shared: true }).shared).toBe(true);
  });
});

describe('canDeleteReflection', () => {
  const row = { author_id: PROFILE.id, shared: false };

  it('lets the author delete their own entry', () => {
    expect(canDeleteReflection(row, PROFILE.id, 'resident')).toBe(true);
  });

  it('blocks leadership on a private entry and a resident on someone else\'s', () => {
    expect(canDeleteReflection(row, 'other', 'director')).toBe(false);
    expect(canDeleteReflection({ ...row, shared: true, author_id: 'other' }, 'other-id', 'resident')).toBe(false);
  });

  it('lets leadership delete an opted-in shared entry', () => {
    const shared = { author_id: 'other', shared: true };
    for (const role of ['director', 'institution_admin', 'admin']) {
      expect(canDeleteReflection(shared, 'other-id', role)).toBe(true);
    }
  });
});

describe('isLeadershipRole', () => {
  it('treats director/institution_admin/admin as leadership and others not', () => {
    expect(isLeadershipRole('director')).toBe(true);
    expect(isLeadershipRole('institution_admin')).toBe(true);
    expect(isLeadershipRole('admin')).toBe(true);
    expect(isLeadershipRole('resident')).toBe(false);
    expect(isLeadershipRole('supervisor')).toBe(false);
  });
});

describe('countWords', () => {
  it('counts whitespace-collapsed words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('one two  three ')).toBe(3);
  });
});

describe('REFLECTION_CHIP_OPTIONS', () => {
  it('covers exactly the DB-allowed categories', () => {
    expect(REFLECTION_CHIP_OPTIONS.map((o) => o.key).sort()).toEqual(
      ['clinical', 'communication', 'ethics', 'other', 'procedural', 'teamwork'].sort()
    );
  });
});
