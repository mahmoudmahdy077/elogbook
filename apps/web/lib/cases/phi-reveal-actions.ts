'use server';

import { createServerSupabase } from '@/lib/supabase/server';
import { recordPhiView } from '@/lib/audit/record-phi-view';
import { isUuid } from '@/lib/audit/audit-contract';

/**
 * Audited reveal of a single direct identifier on a case.
 *
 * Masking a PHI column at render time is not enough on its own: the value still
 * travels to the browser in the server-component payload, so opening a list page
 * ships every MRN on the page to the client whether or not anyone looked at one.
 * The audit row would then describe a disclosure that already happened.
 *
 * So the identifier is not selected at all. It is fetched here, per field, per
 * request, and only after the disclosure has been recorded.
 *
 * Authorization is the RLS policy on `case_entries`, read through the caller's own
 * request-scoped client: this action cannot widen what the caller may see, and a
 * row outside their tenant or outside their own cases simply does not return.
 * AAL1 is sufficient — reading a case you already have access to is not a
 * privileged write, and requiring a step-up here would only teach users to
 * re-verify for a routine view.
 *
 * Fail closed: if the audit row cannot be written, the value is not returned.
 */

export interface PhiRevealResult {
  value: string | null;
  /** Set when the value is withheld, so the UI can say why instead of looking broken. */
  reason?: 'unauthorized' | 'not_found' | 'deidentified' | 'audit_failed';
}

export async function revealCasePhiField(
  entryId: string,
  field: 'mrn' | 'dob',
): Promise<PhiRevealResult> {
  if (!isUuid(entryId)) return { value: null, reason: 'not_found' };
  if (field !== 'mrn' && field !== 'dob') return { value: null, reason: 'not_found' };

  const column = field === 'mrn' ? 'patient_mrn' : 'patient_dob';
  const supabase = await createServerSupabase();

  // RLS decides visibility: no explicit tenant predicate is added here, because
  // the policy is the authority and duplicating it in the application is how the
  // two drift apart.
  const { data: entry, error } = await supabase
    .from('case_entries')
    .select(`id, tenant_id, is_deidentified, ${column}`)
    .eq('id', entryId)
    .maybeSingle();

  if (error || !entry) return { value: null, reason: 'not_found' };
  if (entry.is_deidentified) return { value: null, reason: 'deidentified' };

  const value = (entry as Record<string, unknown>)[column];
  if (typeof value !== 'string' || value.length === 0) {
    return { value: null, reason: 'not_found' };
  }

  // The disclosure is recorded before the value leaves the server. An unaudited
  // identifier must never be returned, so a failed write withholds it.
  const recorded = await recordPhiView(supabase, {
    entryId,
    tenantId: String(entry.tenant_id),
    field,
  });
  if (!recorded) return { value: null, reason: 'audit_failed' };

  return { value };
}
