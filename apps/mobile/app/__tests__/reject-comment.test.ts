import { describe, it, expect } from 'vitest';

// Reject-comment guard: the RPC requires a non-empty trimmed comment.
function validateRejectComment(raw: string): { ok: boolean; reason?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Reason required' };
  }
  if (trimmed.length < 3) {
    return { ok: false, reason: 'Reason too short' };
  }
  return { ok: true };
}

describe('validateRejectComment', () => {
  it('rejects an empty string', () => {
    expect(validateRejectComment('')).toEqual({ ok: false, reason: 'Reason required' });
  });

  it('rejects a whitespace-only string', () => {
    expect(validateRejectComment('   \n\t  ')).toEqual({ ok: false, reason: 'Reason required' });
  });

  it('rejects a comment shorter than 3 chars', () => {
    expect(validateRejectComment('no')).toEqual({ ok: false, reason: 'Reason too short' });
  });

  it('accepts a meaningful comment', () => {
    expect(validateRejectComment('Missing informed consent')).toEqual({ ok: true });
  });

  it('trims leading/trailing whitespace before validating', () => {
    expect(validateRejectComment('  okay  ')).toEqual({ ok: true });
  });
});
