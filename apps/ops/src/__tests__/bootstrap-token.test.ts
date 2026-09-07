import { describe, it, expect } from 'vitest';
import {
  generateBootstrapToken,
  createClaim,
  verifyClaim,
  createMemoryClaimStore,
  TOKEN_TTL_MS,
  MAX_CLAIM_ATTEMPTS,
} from '../bootstrap-token';

// T09: bootstrap ownership claim. Anonymous/expired/replayed claims must
// fail; the token itself is never stored or logged; attempts are throttled.
describe('bootstrap token claim (T09)', () => {
  it('a fresh valid claim verifies exactly once (single-use)', () => {
    const store = createMemoryClaimStore();
    const { token, verifier } = generateBootstrapToken();
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(verifier).not.toContain(token.slice(0, 8));

    const record = createClaim({ installationId: 'inst-1', verifier, now: 1000 });
    store.save(record);

    const first = verifyClaim(store, { installationId: 'inst-1', token, now: 2000 });
    expect(first.ok).toBe(true);

    const replay = verifyClaim(store, { installationId: 'inst-1', token, now: 3000 });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('used');
  });

  it('rejects expired claims', () => {
    const store = createMemoryClaimStore();
    const { token, verifier } = generateBootstrapToken();
    store.save(createClaim({ installationId: 'inst-1', verifier, now: 0 }));
    const res = verifyClaim(store, { installationId: 'inst-1', token, now: TOKEN_TTL_MS + 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('expired');
  });

  it('rejects wrong tokens without revealing which part failed differently than unknown', () => {
    const store = createMemoryClaimStore();
    const { verifier } = generateBootstrapToken();
    store.save(createClaim({ installationId: 'inst-1', verifier, now: 0 }));
    const res = verifyClaim(store, { installationId: 'inst-1', token: 'wrong-token', now: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid');
  });

  it('rejects claims for a different installation as unknown', () => {
    const store = createMemoryClaimStore();
    const { token, verifier } = generateBootstrapToken();
    store.save(createClaim({ installationId: 'inst-1', verifier, now: 0 }));
    const res = verifyClaim(store, { installationId: 'inst-2', token, now: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unknown');
  });

  it(`locks after ${MAX_CLAIM_ATTEMPTS} wrong attempts and stays locked`, () => {
    const store = createMemoryClaimStore();
    const { token, verifier } = generateBootstrapToken();
    store.save(createClaim({ installationId: 'inst-1', verifier, now: 0 }));
    for (let i = 0; i < MAX_CLAIM_ATTEMPTS; i++) {
      verifyClaim(store, { installationId: 'inst-1', token: 'nope', now: 10 + i });
    }
    const locked = verifyClaim(store, { installationId: 'inst-1', token, now: 100 });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.reason).toBe('locked');
  });

  it('rejects anonymous claims (no record)', () => {
    const store = createMemoryClaimStore();
    const res = verifyClaim(store, { installationId: 'inst-1', token: 'anything', now: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('unknown');
  });

  it('tokens are unique per generation', () => {
    const a = generateBootstrapToken().token;
    const b = generateBootstrapToken().token;
    expect(a).not.toBe(b);
  });
});
