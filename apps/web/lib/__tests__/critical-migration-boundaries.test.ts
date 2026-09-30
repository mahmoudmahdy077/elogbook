import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const phiMigration = readFileSync(
  resolve(repoRoot, 'supabase/migrations/20260824170000_phi_scan_definitive_rebuild.sql'),
  'utf8',
);
const paymentMigration = readFileSync(
  resolve(repoRoot, 'supabase/migrations/20260925000003_stripe_event_claim.sql'),
  'utf8',
);

describe('critical database boundaries', () => {
  it('uses a strict nested field allowlist and server-side DLP in the PHI trigger', () => {
    expect(phiMigration).toContain('field_values_contain_phi');
    expect(phiMigration).toContain('SECURITY DEFINER');
    expect(phiMigration).toContain('jsonb_each');
    expect(phiMigration).toContain('patient');
    expect(phiMigration).toContain('\\d{3}-\\d{2}-\\d{4}');
    expect(phiMigration).toContain('\\d{6,}');
    expect(phiMigration).toContain('STREET');
    expect(phiMigration).toContain('@[A-Z0-9.-]');
  });

  it('claims pending and failed Stripe events with a token and completion guard', () => {
    expect(paymentMigration).toContain('claim_stripe_event');
    expect(paymentMigration).toContain("status IN ('pending', 'failed'");
    expect(paymentMigration).toContain('claim_token');
    expect(paymentMigration).toContain('mark_stripe_event_processed');
    expect(paymentMigration).toContain('processed = false');
    expect(paymentMigration).toContain("column_name = 'mode'");
    expect(paymentMigration).toContain("column_name = 'livemode'");
    expect(paymentMigration).toContain('stripe_events.mode = EXCLUDED.mode');
    expect(paymentMigration).toContain('stripe_events.livemode = EXCLUDED.livemode');
  });
});
