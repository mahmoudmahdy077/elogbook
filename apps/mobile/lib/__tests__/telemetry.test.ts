import { describe, it, expect } from 'vitest';
import { buildSyncTelemetry, scrubTelemetry, scrubEventProperties } from '../telemetry';

describe('telemetry M5 (redacted)', () => {
  it('includes operational fields without PHI/tokens/URLs', () => {
    const evt = buildSyncTelemetry({
      queueDepth: 3,
      latencyMs: 1200,
      retryClass: 'transient',
      conflicts: 1,
      dataMode: 'deidentified',
      appVersion: '1.0.0',
      policyVersion: 3,
    });
    expect(evt.queueDepth).toBe(3);
    expect(evt.retryClass).toBe('transient');
    const scrubbed = scrubTelemetry({ ...evt, patientMrn: 'SECRET', token: 'jwt-secret', url: 'https://x?apikey=s' } as never);
    expect(JSON.stringify(scrubbed)).not.toContain('SECRET');
    expect(JSON.stringify(scrubbed)).not.toContain('jwt-secret');
    expect(JSON.stringify(scrubbed)).not.toContain('apikey');
  });

  it('drops raw payloads and form values', () => {
    const scrubbed = scrubTelemetry({ queueDepth: 1, fieldValues: { dx: 'cancer' }, formPayload: { mrn: 'x' } } as never);
    expect('fieldValues' in (scrubbed as object)).toBe(false);
    expect('formPayload' in (scrubbed as object)).toBe(false);
  });

  it('scrubs hostile event fixtures (MRN/DOB/SSN/token/URL/ciphertext/path)', () => {
    const hostile = {
      event: 'case_created',
      patientMrn: 'MRN-999',
      patientDob: '1999-12-31',
      ssn: '123-45-6789',
      token: 'eyJhbGciOiJIUzI1NiJ9.payload',
      url: 'https://xyz.supabase.co/storage/v1/object/public/a?apikey=SECRETKEY',
      ciphertext: '01' + 'ab'.repeat(64),
      file_path: '/data/user/0/photo.jpg',
      template_id: 'tpl-1',
      queueDepth: 2,
    };
    const clean = scrubEventProperties(hostile);
    const payload = JSON.stringify(clean);
    for (const secret of ['MRN-999', '1999-12-31', '123-45-6789', 'eyJhbGciOiJIUzI1NiJ9', 'SECRETKEY', 'ab'.repeat(8), 'photo.jpg']) {
      expect(payload, secret).not.toContain(secret);
    }
    expect(clean.template_id).toBe('tpl-1');
    expect(clean.queueDepth).toBe(2);
  });
});
