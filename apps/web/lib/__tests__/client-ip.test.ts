import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('getClientIp — trusted proxy hop aware (TICKET-002)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWithHops(hops: string | undefined) {
    vi.resetModules();
    if (hops === undefined) {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '');
      // ensure undefined
      delete process.env.TRUSTED_PROXY_HOPS;
    } else {
      vi.stubEnv('TRUSTED_PROXY_HOPS', hops);
    }
    const mod = await import('../client-ip');
    return mod;
  }

  function headers(pairs: Record<string, string>) {
    const h = new Headers();
    for (const [k, v] of Object.entries(pairs)) h.set(k, v);
    return h;
  }

  it('direct connection with no header -> unknown (hops=0) or fallback', async () => {
    const mod = await loadWithHops('0');
    const req = { headers: headers({}), ip: undefined } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req)).toBe('unknown');

    // with x-real-ip fallback
    const req2 = { headers: headers({ 'x-real-ip': '203.0.113.1' }) } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req2)).toBe('203.0.113.1');
  });

  it('rejects client-supplied X-Forwarded-For when hops=0 (spoofed header ignored)', async () => {
    const mod = await loadWithHops('0');
    const req = {
      headers: headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2', 'x-real-ip': '9.9.9.9' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    // must NOT return 1.1.1.1 (spoofed). Should return x-real-ip or unknown, not spoofed.
    const ip = mod.getClientIp(req);
    expect(ip).not.toBe('1.1.1.1');
    expect(ip).not.toBe('2.2.2.2');
    expect(ip).toBe('9.9.9.9');

    // with no x-real-ip, should be unknown, not spoofed
    const req2 = {
      headers: headers({ 'x-forwarded-for': 'evil' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req2)).toBe('unknown');
    expect(mod.getClientIp(req2)).not.toBe('evil');
  });

  it('hops=1: returns last entry (real client as seen by Caddy)', async () => {
    const mod = await loadWithHops('1');
    // Caddy appends real client IP: header "spoofed, real" -> last is real
    const req = {
      headers: headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.5' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req)).toBe('203.0.113.5');

    // single entry (no spoof) -> that entry
    const req2 = {
      headers: headers({ 'x-forwarded-for': '203.0.113.5' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req2)).toBe('203.0.113.5');

    // 3 entries with hops=1 -> last
    const req3 = {
      headers: headers({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 203.0.113.9' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req3)).toBe('203.0.113.9');
  });

  it('hops=2: returns second-last entry', async () => {
    const mod = await loadWithHops('2');
    const req = {
      headers: headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.5, 10.0.0.1' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    // list length 3, hops 2 -> index 1 => 203.0.113.5
    expect(mod.getClientIp(req)).toBe('203.0.113.5');

    // hops=2 with only 1 entry -> insufficient, fallback to x-real-ip
    const req2 = {
      headers: headers({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '9.9.9.9' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req2)).toBe('9.9.9.9');
  });

  it('header absent behind proxy -> falls back to x-real-ip', async () => {
    const mod = await loadWithHops('1');
    const req = {
      headers: headers({ 'x-real-ip': '198.51.100.7' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req)).toBe('198.51.100.7');

    const req2 = {
      headers: headers({}),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req2)).toBe('unknown');
  });

  it('IPv6: bracketed, port-stripped, and IPv4-mapped', async () => {
    const mod = await loadWithHops('1');

    // bracketed IPv6
    expect(mod.normalizeIpToken('[2001:db8::1]')).toBe('2001:db8::1');
    expect(mod.normalizeIpToken('[2001:DB8::1]:1234')).toBe('2001:db8::1');

    // IPv4 with port
    expect(mod.normalizeIpToken('1.2.3.4:8080')).toBe('1.2.3.4');
    expect(mod.normalizeIpToken('1.2.3.4')).toBe('1.2.3.4');

    // bare IPv6 (no brackets, no port stripping)
    expect(mod.normalizeIpToken('2001:db8::1')).toBe('2001:db8::1');

    // IPv4-mapped
    expect(mod.normalizeIpToken('::ffff:1.2.3.4')).toBe('::ffff:1.2.3.4');

    // via getClientIp with IPv6 header
    const req = {
      headers: headers({ 'x-forwarded-for': '1.1.1.1, [2001:db8::1]:1234' }),
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req)).toBe('2001:db8::1');

    // multiple hops IPv6
    const mod2 = await loadWithHops('2');
    const req2 = {
      headers: headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.5, [2001:db8::2]' }),
    } as unknown as Parameters<typeof mod2.getClientIp>[0];
    expect(mod2.getClientIp(req2)).toBe('203.0.113.5');
  });

  it('uses socket ip when available and hops=0', async () => {
    const mod = await loadWithHops('0');
    const req = {
      headers: headers({}),
      ip: '198.51.100.9',
    } as unknown as Parameters<typeof mod.getClientIp>[0];
    expect(mod.getClientIp(req)).toBe('198.51.100.9');
  });

  it('Gate G: only client-ip.ts reads x-forwarded-for (single source)', async () => {
    // This test documents the invariant; the actual gate is in CI via grep.
    // We assert the helper itself consults TRUSTED_PROXY_HOPS.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const candidates = [
      join(process.cwd(), 'lib/client-ip.ts'),
      join(process.cwd(), 'apps/web/lib/client-ip.ts'),
      join(process.cwd(), '../lib/client-ip.ts'),
    ];
    let src = '';
    for (const p of candidates) {
      try {
        src = readFileSync(p, 'utf8');
        break;
      } catch {}
    }
    expect(src).toMatch(/TRUSTED_PROXY_HOPS/);
    expect(src).toMatch(/x-forwarded-for/i);
  });
});
