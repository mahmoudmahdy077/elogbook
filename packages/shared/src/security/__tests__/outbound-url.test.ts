import { describe, expect, it } from 'vitest';
import {
  isSafeOutboundUrl,
  validateOutboundUrl,
  validateRedirectUrl,
  validateResolvedAddresses,
} from '../outbound-url';

const policy = {
  allowedHosts: ['example.com', 'api.example.com'],
};

describe('outbound URL policy', () => {
  it('rejects non-HTTPS URLs', () => {
    expect(() => validateOutboundUrl('http://example.com/webhook', policy)).toThrow();
  });

  it('rejects localhost and local hostnames', () => {
    for (const url of [
      'https://localhost/webhook',
      'https://localhost./webhook',
      'https://app.localhost/webhook',
      'https://local-host/webhook',
    ]) {
      expect(() => validateOutboundUrl(url, policy)).toThrow();
    }
  });

  it('rejects loopback, private, link-local, and reserved IPv4 ranges', () => {
    for (const host of [
      '127.0.0.1',
      '127.255.255.254',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(() => validateOutboundUrl(`https://${host}/webhook`, policy)).toThrow();
    }
  });

  it('rejects cloud metadata hosts and addresses', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'https://metadata.google.internal/computeMetadata/v1',
      'https://metadata.google.internal./computeMetadata/v1',
      'https://[fd00:ec2::254]/latest/meta-data',
    ]) {
      expect(() => validateOutboundUrl(url, policy)).toThrow();
    }
  });

  it('rejects IPv4-mapped IPv6 loopback and private addresses', () => {
    for (const host of [
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]',
      '[::ffff:192.168.1.1]',
      '[::ffff:10.0.0.1]',
    ]) {
      expect(() => validateOutboundUrl(`https://${host}/webhook`, policy)).toThrow();
    }
  });

  it('rejects alternate IPv4 encodings and malformed ports', () => {
    for (const url of [
      'https://127.1/webhook',
      'https://2130706433/webhook',
      'https://0177.0.0.1/webhook',
      'https://0x7f000001/webhook',
      'https://example.com:0/webhook',
      'https://example.com:65536/webhook',
      'https://example.com:-1/webhook',
    ]) {
      expect(() => validateOutboundUrl(url, policy)).toThrow();
    }
  });

  it('rejects unsafe redirects and accepts same-host HTTPS redirects', () => {
    const current = validateOutboundUrl('https://example.com/start', policy);
    const next = validateRedirectUrl('https://example.com/next', current, policy);
    expect(next.toString()).toBe('https://example.com/next');
    expect(() => validateRedirectUrl('http://example.com/next', current, policy)).toThrow();
    expect(() => validateRedirectUrl('https://other.example/next', current, policy)).toThrow();
  });

  it('rejects DNS answers that include a private address', () => {
    expect(() => validateResolvedAddresses('example.com', ['93.184.216.34', '127.0.0.1'])).toThrow();
    expect(validateResolvedAddresses('example.com', ['93.184.216.34'])).toEqual(['93.184.216.34']);
  });

  it('allows an approved HTTPS host', () => {
    const url = validateOutboundUrl('https://example.com/webhook', policy);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('example.com');
    expect(isSafeOutboundUrl('https://example.com/webhook', policy)).toBe(true);
    expect(isSafeOutboundUrl('https://unapproved.example/webhook', policy)).toBe(false);
    expect(isSafeOutboundUrl('https://sub.example.com/webhook', { allowedHosts: ['example.com'] })).toBe(false);
  });
});
