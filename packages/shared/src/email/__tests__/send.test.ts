// packages/shared/src/email/__tests__/send.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendWithFailover } from '../send';

describe('sendWithFailover', () => {
  it('falls over to smtp on resend 500', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 500 }));
    const smtp = vi.fn().mockResolvedValue({ id: 'smtp-1' });
    const out = await sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp });
    expect(out).toEqual({ id: 'smtp-1', via: 'smtp' });
  });
  it('does not fail over on resend 400', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad addr'), { status: 400 }));
    const smtp = vi.fn();
    await expect(sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp })).rejects.toThrow();
    expect(smtp).not.toHaveBeenCalled();
  });
});
