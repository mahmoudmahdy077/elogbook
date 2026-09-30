import { describe, expect, it, vi } from 'vitest';
import { outboundRequest, outboundRequestJson } from '../outbound-request';

const url = 'https://hooks.example.com/events';

describe('outbound request policy', () => {
  it('fails closed when DNS returns a private address', async () => {
    const fetchImpl = vi.fn();
    const result = await outboundRequest(url, {
      allowedHosts: ['hooks.example.com'],
      resolveHostname: async () => ['93.184.216.34', '127.0.0.1'],
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, status: 0, category: 'blocked' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires an explicit allowlist for custom hosts', async () => {
    const fetchImpl = vi.fn();
    const result = await outboundRequest(url, {
      requireAllowlist: true,
      resolveHostname: async () => ['93.184.216.34'],
      fetchImpl,
    });
    expect(result.category).toBe('blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not follow redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    const result = await outboundRequest(url, {
      allowedHosts: ['hooks.example.com'],
      resolveHostname: async () => ['93.184.216.34'],
      fetchImpl,
    });
    expect(result.category).toBe('redirect');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('caps response bodies and does not expose raw bodies by default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('x'.repeat(100), { status: 200 }));
    const result = await outboundRequest(url, {
      allowedHosts: ['hooks.example.com'],
      resolveHostname: async () => ['93.184.216.34'],
      maxResponseBytes: 10,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, status: 200, category: 'too_large' });
    expect('data' in result).toBe(false);
  });

  it('parses bounded JSON only when explicitly requested', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const result = await outboundRequestJson<{ ok: boolean }>(url, {
      allowedHosts: ['hooks.example.com'],
      resolveHostname: async () => ['93.184.216.34'],
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('rejects oversized request bodies before DNS or fetch', async () => {
    const resolveHostname = vi.fn();
    const fetchImpl = vi.fn();
    const result = await outboundRequest(url, {
      allowedHosts: ['hooks.example.com'],
      maxRequestBodyBytes: 4,
      body: '12345',
      resolveHostname,
      fetchImpl,
    });
    expect(result.category).toBe('too_large');
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
