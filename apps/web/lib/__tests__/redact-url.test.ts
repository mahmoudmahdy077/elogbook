import { describe, it, expect } from 'vitest';
import { redactUrl } from '../redact-url';

describe('redactUrl', () => {
  it('keeps scheme and host only', () => {
    expect(redactUrl('https://hooks.slack.com/services/T000/B000/SECRET')).toBe(
      'https://hooks.slack.com',
    );
  });

  it('drops discord webhook tokens carried in the path', () => {
    expect(redactUrl('https://discord.com/api/webhooks/123/abcdefTOKEN')).toBe(
      'https://discord.com',
    );
  });

  it('drops query strings that carry signatures', () => {
    expect(redactUrl('https://relay.example.com/hook?sig=deadbeef&t=1')).toBe(
      'https://relay.example.com',
    );
  });

  it('drops userinfo credentials', () => {
    expect(redactUrl('https://user:pass@relay.example.com/hook')).toBe(
      'https://relay.example.com',
    );
  });

  it('keeps a non-default port', () => {
    expect(redactUrl('http://10.0.0.5:8080/hook')).toBe('http://10.0.0.5:8080');
  });

  it('never echoes unparseable or unsupported input', () => {
    expect(redactUrl('not a url')).toBe('unknown');
    expect(redactUrl('javascript:alert(1)')).toBe('unknown');
    expect(redactUrl('')).toBe('unknown');
    expect(redactUrl(undefined)).toBe('unknown');
    expect(redactUrl(null)).toBe('unknown');
    expect(redactUrl(42)).toBe('unknown');
  });
});
