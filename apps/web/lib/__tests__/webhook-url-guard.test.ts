import { describe, it, expect } from 'vitest';
import {
  assertSafeWebhookUrl,
  isBlockedHostname,
  isBlockedIp,
  UnsafeWebhookUrlError,
} from '../webhook-url-guard';

describe('isBlockedIp', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.5.4',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('blocks private/reserved IPv4 %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '203.0.114.1'])(
    'allows public IPv4 %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it.each(['::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1'])(
    'blocks reserved IPv6 %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    },
  );

  it('classifies IPv4-mapped IPv6 by the embedded address', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('blocks NAT64-wrapped addresses', () => {
    expect(isBlockedIp('64:ff9b::a00:1')).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('fails closed on a non-IP string', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'app.localhost',
    'printer.local',
    'db.internal',
    'router.home.arpa',
    'metadata.google.internal',
    'service.svc',
  ])('blocks %s', (host) => {
    expect(isBlockedHostname(host)).toBe(true);
  });

  it.each(['example.com', 'hooks.slack.com', 'localhost.example.com'])('allows %s', (host) => {
    expect(isBlockedHostname(host)).toBe(false);
  });
});

describe('assertSafeWebhookUrl', () => {
  const publicResolve = async () => [{ address: '93.184.216.34' }];

  it('accepts a public HTTPS URL', async () => {
    await expect(
      assertSafeWebhookUrl('https://example.com/hooks/1', { resolve: publicResolve, requireHttps: true }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('rejects a non-http scheme', async () => {
    await expect(assertSafeWebhookUrl('ftp://example.com/x', { resolve: publicResolve })).rejects.toThrow(
      UnsafeWebhookUrlError,
    );
  });

  it('rejects embedded credentials', async () => {
    await expect(
      assertSafeWebhookUrl('https://user:pass@example.com/x', { resolve: publicResolve }),
    ).rejects.toThrow(/credentials/);
  });

  it('requires HTTPS when asked', async () => {
    await expect(
      assertSafeWebhookUrl('http://example.com/x', { resolve: publicResolve, requireHttps: true }),
    ).rejects.toThrow(/HTTPS/);
  });

  it('rejects localhost and metadata hosts without resolving them', async () => {
    await expect(assertSafeWebhookUrl('http://localhost:3000/x')).rejects.toThrow(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('http://metadata.google.internal/x'),
    ).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it('rejects a private IP literal', async () => {
    await expect(assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      UnsafeWebhookUrlError,
    );
    await expect(assertSafeWebhookUrl('http://[::1]/x')).rejects.toThrow(UnsafeWebhookUrlError);
  });

  it('rejects a public name that resolves to a private address', async () => {
    await expect(
      assertSafeWebhookUrl('https://evil.example/x', {
        resolve: async () => [{ address: '10.0.0.5' }],
      }),
    ).rejects.toThrow(/private address/);
  });

  it('rejects when any answer is private', async () => {
    await expect(
      assertSafeWebhookUrl('https://mixed.example/x', {
        resolve: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }],
      }),
    ).rejects.toThrow(/private address/);
  });

  it('rejects an unresolvable host', async () => {
    await expect(
      assertSafeWebhookUrl('https://nope.example/x', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toThrow(/resolved/);
  });

  it('rejects malformed input', async () => {
    await expect(assertSafeWebhookUrl('not a url')).rejects.toThrow(/Invalid URL/);
  });

  it('accepts a public IP literal without DNS', async () => {
    await expect(assertSafeWebhookUrl('https://93.184.216.34/x')).resolves.toBeInstanceOf(URL);
    await expect(assertSafeWebhookUrl('https://[2606:4700:4700::1111]/x')).resolves.toBeInstanceOf(URL);
  });
});
