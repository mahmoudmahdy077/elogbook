// Dependency-free by design: this suite only reads source text, so it runs with
// `--frozen --no-config --allow-read` and no network.
//
// Scope: surfaces that leave the deployment to a third party. A vendor egress
// must never carry a raw clinical identifier, because the vendor sits outside
// the tenant boundary and outside our retention and access controls. The same
// applies to the PDF report, which is a clinical document and must only be
// produced under the documented single-resident supervisor scope.
//
// A column name may legitimately appear in a *type* declaration: `WebadsRawRow`
// declares the identifier fields as optional precisely so the projection can be
// tested proving it drops them. What must hold is that the select list, the
// handler's select clauses, and the payload builder never read or emit them.
//
// Every source read goes through `readSource`, which strips comments first. That
// is not cosmetic: three of the files below carry the very identifiers this
// suite forbids, in their rationale paragraphs. A rationale saying "the query no
// longer selects `field_values`" is prose, and a check that reads prose as code
// both fails for the wrong reason and can be satisfied by a comment. Stripping
// at the single read point is what makes a comment unable to satisfy a positive
// or trip a negative, anywhere in this file.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Remove block comments, then line comments that are not inside a string.
 *
 * The line pass is quote-aware rather than a whole-line pattern, so a trailing
 * note is removed while the `//` in a URL or a path is left alone. Block
 * comments collapse to a single space so a comment sitting between two tokens
 * cannot join them into a different token.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(stripTrailingLineComment)
    .join('\n');
}

function stripTrailingLineComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '/' && line[index + 1] === '/') return line.slice(0, index);
  }
  return line;
}

const RAW_IDENTIFIER_COLUMNS = [
  'patient_mrn',
  'patient_dob',
  'date_of_birth',
  'dob',
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'email',
  'address',
  'national_id',
  'ssn',
  'insurance_id',
  'notes',
] as const;

/**
 * The identifier matchers, built once.
 *
 * Each column is a fixed set of shapes: a bare word in code, and a quoted token
 * in a select list. Deriving them per clause rebuilt the same fourteen patterns
 * for every clause of every file; hoisting them bounds the work to fourteen
 * patterns for the whole run and makes the set being enforced readable in one
 * place, which is the point of a DLP check.
 */
const RAW_IDENTIFIER_WORD = RAW_IDENTIFIER_COLUMNS.map(
  (column) => [column, new RegExp(`\\b${column}\\b`)] as const,
);
const RAW_IDENTIFIER_QUOTED = RAW_IDENTIFIER_COLUMNS.map(
  (column) => [column, new RegExp(`['"\`]${column}['"\`]`, 'u')] as const,
);

/** The first identifier column present in `text`, or null. */
function firstRawIdentifierWord(text: string): string | null {
  for (const [column, pattern] of RAW_IDENTIFIER_WORD) {
    if (pattern.test(text)) return column;
  }
  return null;
}

function firstRawIdentifierQuoted(text: string): string | null {
  for (const [column, pattern] of RAW_IDENTIFIER_QUOTED) {
    if (pattern.test(text)) return column;
  }
  return null;
}

const POLICY_MODULE = 'webads-export/export-policy.ts';
const HANDLER = 'webads-export/index.ts';
const PDF_HANDLER = 'generate-pdf/index.ts';
const SHARED_AUDIT = '_shared/audit.ts';

/** Read a sibling function source with its comments removed. */
function readSource(relativePath: string): string {
  return stripComments(Deno.readTextFileSync(new URL(`./${relativePath}`, import.meta.url)));
}

Deno.test('comment stripping removes a rationale without touching a string', () => {
  const source = stripComments([
    "const endpoint = 'https://vendor.example/submit'; // POST here",
    '/* the query no longer selects `field_values` */',
    'const keep = 1; /* mid */ const also = 2;',
    '// a whole-line note',
  ].join('\n'));

  assert(!source.includes('POST here'), 'a trailing line comment must be removed');
  assert(!source.includes('field_values'), 'a block comment must be removed');
  assert(!source.includes('mid'), 'a block comment must be removed');
  assert(!source.includes('whole-line note'), 'a whole-line comment must be removed');
  assert(source.includes("'https://vendor.example/submit'"), 'a quoted URL must survive');
  assert(source.includes('const keep = 1;'), 'the code around a block comment must survive');
  assert(source.includes('const also = 2;'), 'a block comment must not join two tokens into one');
});

Deno.test('the webads select list omits every raw clinical identifier column', () => {
  const source = readSource(POLICY_MODULE);
  const selectLiteral = source.match(/WEBADS_EXPORT_SELECT\s*=\s*\[([\s\S]*?)\]/);

  assert(selectLiteral, `${POLICY_MODULE} must declare an explicit select list`);

  const leaked = firstRawIdentifierQuoted(selectLiteral[1]);
  assert(leaked === null, `${POLICY_MODULE} must not select ${leaked}`);
});

Deno.test('the webads payload builder emits no resident identity', () => {
  const source = readSource(POLICY_MODULE);
  const start = source.indexOf('export function projectWebadsEntries');
  assert(start !== -1, 'projectWebadsEntries must exist');

  const next = source.indexOf('export function', start + 1);
  const builder = source.slice(start, next === -1 ? source.length : next);
  assert(builder.length > 0, 'the payload builder body must be inspectable');

  const leaked = firstRawIdentifierWord(builder);
  assert(leaked === null, `projectWebadsEntries must not project ${leaked}`);
});

Deno.test('no vendor egress select clause requests a raw identifier column', () => {
  const source = readSource(HANDLER);
  const clauses = source.match(/\.select\(([^)]*)\)/g) ?? [];

  assert(clauses.length > 0, 'the export handler must declare at least one select');

  for (const clause of clauses) {
    const leaked = firstRawIdentifierWord(clause);
    assert(leaked === null, `a webads select must not request ${leaked}: ${clause}`);
  }
});

Deno.test('the webads vendor policy cannot be widened past metadata_only', () => {
  const source = readSource(POLICY_MODULE);

  assert(
    source.includes("WEBADS_PAYLOAD_POLICY = 'metadata_only'"),
    'the vendor payload policy must remain metadata_only',
  );
  assert(
    source.includes('policy.approvedPolicy !== WEBADS_PAYLOAD_POLICY'),
    'export authorization must reject any policy that is not metadata_only',
  );
});

Deno.test('the webads vendor feed is default-deny when no vendor is configured', () => {
  const source = readSource(HANDLER);

  assert(
    source.includes("Deno.env.get('WEBADS_EXPORT_ENABLED') === 'true'"),
    'the external export must be gated on a configured vendor',
  );
});

Deno.test('the generate-pdf handler never accepts a client-supplied resident name', () => {
  const source = readSource(PDF_HANDLER);

  assert(!source.includes('resident_name'), 'generate-pdf must not read a client-supplied resident_name');
  assert(source.includes('scope.residentId'), 'generate-pdf must scope to a single resident id');
  assert(
    !/select\([^)]*field_values/.test(source),
    'generate-pdf must not select free-text field_values',
  );
});

Deno.test('the shared edge audit writer only targets the trusted RPC', () => {
  const source = readSource(SHARED_AUDIT);

  assert(source.includes("AUDIT_WRITE_RPC = 'write_audit_event'"), 'the shared writer must target write_audit_event');
  assert(!source.includes('audit_logs'), 'the shared writer must not touch audit_logs directly');
});

// The per-surface checks come last so the registration order reads top to bottom:
// Deno registers in evaluation order, and a loop in the middle of the file
// otherwise interleaves its tests with the standalone ones above it.
for (const relativePath of [HANDLER, PDF_HANDLER]) {
  Deno.test(`${relativePath} does not build a service-role client for audit writes`, () => {
    const source = readSource(relativePath);
    assert(
      !source.includes('createServiceRoleClient') && !source.includes('SUPABASE_SERVICE_ROLE_KEY'),
      `${relativePath} must write audit events through the authenticated RPC, not a service-role client`,
    );
  });

  Deno.test(`${relativePath} writes a required audit event and fails closed`, () => {
    const source = readSource(relativePath);
    assert(source.includes('writeAuditEvent'), `${relativePath} must write an audit event`);
    assert(
      source.includes('Audit write failed'),
      `${relativePath} must withhold the document when the audit write fails`,
    );
    assert(
      source.includes("'Cache-Control': 'no-store'"),
      `${relativePath} must mark the response no-store`,
    );
  });

  Deno.test(`${relativePath} never surfaces a database error to the caller`, () => {
    const source = readSource(relativePath);
    assert(
      !/console\.error\([^)]*error\s*[,)]/.test(source),
      `${relativePath} must not log or return a raw database error`,
    );
    assert(
      !/\.message\}/.test(source),
      `${relativePath} must not echo an error message in a response body`,
    );
  });
}
