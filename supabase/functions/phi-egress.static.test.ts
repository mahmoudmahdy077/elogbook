// Dependency-free by design: this suite only reads source text, so it runs with
// `--frozen --no-config --allow-read` and no network.
//
// Scope: surfaces that leave the deployment to a third party. A vendor egress
// must never carry a raw clinical identifier, because the vendor sits outside
// the tenant boundary and outside our retention and access controls.
//
// A column name may legitimately appear in a *type* declaration: `WebadsRawRow`
// declares the identifier fields as optional precisely so the projection can be
// tested proving it drops them. What must hold is that the select list, the
// handler's select clauses, and the payload builder never read or emit them.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
];

const POLICY_MODULE = 'webads-export/export-policy.ts';
const HANDLER = 'webads-export/index.ts';

function readSource(relativePath: string): string {
  return Deno.readTextFileSync(new URL(`./${relativePath}`, import.meta.url));
}

Deno.test('the webads select list omits every raw clinical identifier column', () => {
  const source = readSource(POLICY_MODULE);
  const selectLiteral = source.match(/WEBADS_EXPORT_SELECT\s*=\s*\[([\s\S]*?)\]/);

  assert(selectLiteral, `${POLICY_MODULE} must declare an explicit select list`);

  for (const column of RAW_IDENTIFIER_COLUMNS) {
    assert(
      !new RegExp(`['"\`]${column}['"\`]`).test(selectLiteral[1]),
      `${POLICY_MODULE} must not select ${column}`,
    );
  }
});

Deno.test('the webads payload builder emits no resident identity', () => {
  const source = readSource(POLICY_MODULE);
  const start = source.indexOf('export function projectWebadsEntries');
  assert(start !== -1, 'projectWebadsEntries must exist');

  const next = source.indexOf('export function', start + 1);
  const builder = source.slice(start, next === -1 ? source.length : next);
  assert(builder.length > 0, 'the payload builder body must be inspectable');

  for (const column of RAW_IDENTIFIER_COLUMNS) {
    assert(
      !new RegExp(`\\b${column}\\b`).test(builder),
      `projectWebadsEntries must not project ${column}`,
    );
  }
});

Deno.test('no vendor egress select clause requests a raw identifier column', () => {
  const source = readSource(HANDLER);
  const clauses = source.match(/\.select\(([^)]*)\)/g) ?? [];

  assert(clauses.length > 0, 'the export handler must declare at least one select');

  for (const clause of clauses) {
    for (const column of RAW_IDENTIFIER_COLUMNS) {
      assert(
        !new RegExp(`\\b${column}\\b`).test(clause),
        `a webads select must not request ${column}: ${clause}`,
      );
    }
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
