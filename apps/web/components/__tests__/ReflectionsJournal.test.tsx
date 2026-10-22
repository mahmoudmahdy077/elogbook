import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReflectionsJournal, {
  wordCount,
  typeLabel,
  formatReflectionDate,
  splitReflections,
  previewText,
  type ReflectionRow,
} from '../ReflectionsJournal';

function row(overrides: Partial<ReflectionRow> = {}): ReflectionRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    author_id: '22222222-2222-2222-2222-222222222222',
    case_id: null,
    reflection_type: 'clinical',
    title: 'Difficult fracture reduction',
    body: 'What went well: closed reduction succeeded on the second attempt.',
    prompt: null,
    shared: false,
    created_at: '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('reflection helpers', () => {
  it('counts words including edge cases', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('   ')).toBe(0);
    expect(wordCount('one')).toBe(1);
    expect(wordCount('three short words')).toBe(3);
    expect(wordCount('  multi   space  text ')).toBe(3);
  });

  it('humanizes reflection types', () => {
    expect(typeLabel('clinical')).toBe('Clinical');
    expect(typeLabel('other')).toBe('Other');
  });

  it('formats dates as readable dates', () => {
    expect(formatReflectionDate('2026-10-22T10:00:00.000Z')).toMatch(/2026/);
  });

  it('splits own vs shared reflections by author', () => {
    const viewer = '22222222-2222-2222-2222-222222222222';
    const other = '33333333-3333-3333-3333-333333333333';
    const { mine, shared } = splitReflections(
      [row({ author_id: viewer }), row({ author_id: other, shared: true })],
      viewer
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].author_id).toBe(viewer);
    expect(shared).toHaveLength(1);
    expect(shared[0].author_id).toBe(other);
  });

  it('splits empty lists without crashing', () => {
    const { mine, shared } = splitReflections([], 'x');
    expect(mine).toEqual([]);
    expect(shared).toEqual([]);
  });

  it('previews long bodies on a word boundary with ellipsis', () => {
    const long = row().body.repeat(20);
    expect(previewText(long).length).toBeLessThanOrEqual(201);
    expect(previewText(long).endsWith('…')).toBe(true);
    expect(previewText(row().body)).toBe(row().body);
  });
});

describe('ReflectionsJournal render', () => {
  it('renders own reflection cards with title, type, and sharing note', () => {
    const html = renderToStaticMarkup(
      <ReflectionsJournal
        tenantId="t"
        authorId="22222222-2222-2222-2222-222222222222"
        isLeadership
        reflections={[row()]}
      />
    );
    expect(html).toContain('Reflections');
    expect(html).toContain('Difficult fracture reduction');
    expect(html).toContain('Clinical');
    expect(html).toContain('Shared with leadership');
  });

  it('renders empty state without crashing', () => {
    const html = renderToStaticMarkup(
      <ReflectionsJournal
        tenantId="t"
        authorId="22222222-2222-2222-2222-222222222222"
        isLeadership={false}
        reflections={[]}
      />
    );
    expect(html).toContain('No reflections yet');
  });

  it('hides the shared-with-leadership section for non-leadership roles', () => {
    const html = renderToStaticMarkup(
      <ReflectionsJournal
        tenantId="t"
        authorId="22222222-2222-2222-2222-222222222222"
        isLeadership={false}
        reflections={[row()]}
      />
    );
    expect(html).not.toContain('Shared with leadership');
  });

  it('shows the shared section placeholder for leadership when nothing shared', () => {
    const html = renderToStaticMarkup(
      <ReflectionsJournal
        tenantId="t"
        authorId="22222222-2222-2222-2222-222222222222"
        isLeadership
        reflections={[]}
      />
    );
    expect(html).toContain('Shared with leadership');
    expect(html).toContain('Nothing shared yet');
  });

  it('renders shared author name when present', () => {
    const sharedRow = row({
      author_id: '33333333-3333-3333-3333-333333333333',
      shared: true,
      ...({ profiles: { full_name: 'Sara Resident' } } as object),
    });
    const html = renderToStaticMarkup(
      <ReflectionsJournal
        tenantId="t"
        authorId="22222222-2222-2222-2222-222222222222"
        isLeadership
        reflections={[sharedRow]}
      />
    );
    expect(html).toContain('Sara Resident');
  });
});
