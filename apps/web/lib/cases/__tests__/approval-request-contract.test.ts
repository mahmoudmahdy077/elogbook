import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const callers = [
  'components/ApprovalActions.tsx',
  'components/CasePreviewModal.tsx',
  'components/approvals/ApprovalsDashboard.tsx',
];

describe('approval command callers', () => {
  it.each(callers)('%s sends an idempotency request_id', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toContain('request_id');
  });
});
