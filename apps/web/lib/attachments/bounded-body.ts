/**
 * Bounded request-body reader.
 *
 * A streamed upload body is untrusted input of unknown length. `arrayBuffer()`
 * and `text()` are not available on this path: they allocate whatever the
 * client chooses to send, so a single request with no `content-length` and an
 * endless stream is an out-of-memory primitive.
 *
 * The reader therefore pulls until the cap is crossed, cancels the stream at
 * that point, and never holds more than one chunk beyond the limit. The bytes
 * it returns are a single contiguous buffer because the downstream validator
 * needs to inspect magic bytes and the storage client needs one blob -- bounded,
 * not streamed to the end.
 */

export type BoundedBodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'too_large' | 'unreadable' };

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return { ok: false, reason: 'too_large' };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const cancelQuietly = async () => {
    try {
      await reader.cancel();
    } catch {
      // The stream is already gone; the refusal below is what the caller acts
      // on, so a cancel failure must not change the outcome.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling. Everything after this point is refused without being
        // read, which is the entire point of the cap.
        await cancelQuietly();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    await cancelQuietly();
    return { ok: false, reason: 'unreadable' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
