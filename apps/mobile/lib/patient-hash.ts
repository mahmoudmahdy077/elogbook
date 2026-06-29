import * as Crypto from 'expo-crypto';
import { CryptoDigestAlgorithm } from 'expo-crypto';

// Tenant-scoped SHA-256 hash for patient identifiers. Replaces the previous
// 32-bit DJB2 + Date.now()/Math.random() salt, which was non-deterministic
// and cryptographically broken. The hash input format mirrors the server-side
// `hash_patient_mrn(p_mrn TEXT, p_tenant_id UUID)` family: the tenant id acts
// as a per-tenant salt prefix so hashes do not collide across tenants. A
// full server-side salt (e.g. `app.mrn_hash_salt`) can be plumbed in later
// (see plan §P5.x) without changing call sites.
export async function generatePatientHash(
  tenantId: string,
  mrn: string,
  dob: string,
): Promise<string> {
  return Crypto.digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `${tenantId}:${mrn}:${dob}`,
  );
}
