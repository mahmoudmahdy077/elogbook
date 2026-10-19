import { describe, expect, it, vi } from 'vitest';
import { readBoundedBody } from '../bounded-body';

// A streamed request body is untrusted input of unknown length. These tests pin
// the property that makes the upload route survivable: the reader stops pulling
// at the cap, cancels the stream, and never materialises more than the limit.

function streamed(chunks: Uint8Array[], onPull?: () => void): { request: Request; produced: () => number; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.();
      const next = chunks[index++];
      if (!next) {
        controller.close();
        return;
      }
      controller.enqueue(next);
    },
    cancel,
  });
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    body,
    ...({ duplex: 'half' } as Record<string, string>),
  });
  return { request, produced: () => index, cancel };
}

describe('readBoundedBody', () => {
  it('returns the concatenated body when it fits', async () => {
    const { request } = streamed([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const result = await readBoundedBody(request, 10);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
  });

  it('refuses and cancels once the cap is crossed', async () => {
    const { request, cancel } = streamed([new Uint8Array(8), new Uint8Array(8)]);
    const result = await readBoundedBody(request, 10);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(cancel).toHaveBeenCalled();
  });

  it('stops pulling an endless stream at the limit', async () => {
    const chunk = new Uint8Array(1024);
    const { request, produced, cancel } = streamed(Array.from({ length: 10_000 }, () => chunk));
    const result = await readBoundedBody(request, 8 * 1024);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(cancel).toHaveBeenCalled();
    // Read until the cap, then stopped. Buffering to the end would be 10 MB for
    // a request the client never finished sending.
    expect(produced()).toBeLessThanOrEqual(10);
  });

  it('treats a stream that errors as unreadable rather than partially valid', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.error(new Error('socket reset'));
      },
    });
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body,
      ...({ duplex: 'half' } as Record<string, string>),
    });
    expect(await readBoundedBody(request, 10)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('refuses a non-positive or fractional cap instead of trusting it', async () => {
    const { request } = streamed([new Uint8Array([1])]);
    expect(await readBoundedBody(request, 0)).toEqual({ ok: false, reason: 'too_large' });
    expect(await readBoundedBody(request, 1.5)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('treats a body-less request as empty rather than failing', async () => {
    const request = new Request('http://localhost/upload', { method: 'GET' });
    expect(await readBoundedBody(request, 10)).toEqual({ ok: true, bytes: new Uint8Array() });
  });
});
