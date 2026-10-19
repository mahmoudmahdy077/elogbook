import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';

/**
 * Faculty evaluation corrections.
 *
 * The scores on a faculty evaluation are write-once. That is fail-closed and it
 * means a score entered in good faith and filed cannot be fixed -- and the only
 * workaround, filing a second evaluation, changes the count a program reports as
 * well as the average, which destroys the audit trail a correction is supposed to
 * preserve.
 *
 * So the correction is a command rather than a permission. This route is the door
 * to public.correct_faculty_evaluation, and the command is the lock. The roles
 * here are exactly the roles the command admits, so the route refuses nothing the
 * database would allow and the database refuses nothing the route appears to
 * allow -- a mismatch in either direction is how a narrow route becomes a wide
 * one.
 *
 * The route owns the request shape and nothing else. The reason, the tenant, the
 * row and the AAL2 claim are all decided in the database; the schema here exists
 * so an unrecognised key never reaches the command at all.
 */
export const CORRECTION_ROLES = [
  'supervisor',
  'director',
  'institution_admin',
  'admin',
] as const;

/**
 * A score is an integer 1-5, matching the column's own CHECK. A float is not
 * "nearly right", it is a different type, and the column would round it silently
 * while the caller believed it had stored what it sent.
 */
const scoreSchema = z.number().int().min(1).max(5);

/**
 * The correction payload is a closed set of the row's own score columns plus its
 * comment. Anything else -- a resident id, a tenant id, a status -- is refused at
 * the door rather than forwarded and dropped, because "forwarded and dropped" is
 * indistinguishable from "silently accepted" to whoever reads the audit trail.
 */
const correctionSchema = z
  .object({
    clinical_skills: scoreSchema.optional(),
    professionalism: scoreSchema.optional(),
    procedures: scoreSchema.optional(),
    comments: z.string().max(2000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'a correction must change something',
  });

const correctSchema = z
  .object({
    evaluation_id: z.string().trim().uuid(),
    reason: z.string().trim().min(8).max(1000),
    correction: correctionSchema,
    idempotency_key: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

/** The command's closed error vocabulary, mapped to what the caller may be told. */
const ERROR_STATUS: Record<string, number> = {
  forbidden: 403,
  evaluation_not_found: 404,
  reason_required: 400,
  invalid_request: 400,
  idempotency_conflict: 409,
  no_change: 400,
};

const ERROR_MESSAGE: Record<string, string> = {
  forbidden: 'Insufficient permissions',
  evaluation_not_found: 'Evaluation not found',
  reason_required: 'A reason is required to correct an evaluation',
  invalid_request: 'Invalid correction',
  idempotency_conflict: 'That idempotency key was already used for another correction',
  no_change: 'That correction would not change anything',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, correctSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`faculty-correction:${tenantSlug}`, 30);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, [...CORRECTION_ROLES]);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const { evaluation_id, reason, correction, idempotency_key } = guarded.data;

  // The tenant is the caller's own, taken from the resolved principal rather than
  // from the request. The command checks it again; this is not a second gate, it
  // is not sending the wrong tenant to be told off by the database.
  const { data, error } = await supabase.rpc('correct_faculty_evaluation', {
    p_tenant_id: profile.tenant_id,
    p_evaluation_id: evaluation_id,
    p_reason: reason,
    p_correction: correction,
    p_idempotency_key: idempotency_key ?? null,
  });

  const result = (data ?? null) as { success?: boolean; error?: string; correction_id?: string } | null;
  if (error) {
    // The database message names constraints and columns. It is logged under
    // redaction and never returned.
    logger.error('Failed to file a faculty evaluation correction', error, {
      tenantSlug,
      evaluationId: evaluation_id,
    });
    return NextResponse.json({ error: 'Failed to file the correction' }, { status: 500 });
  }

  if (result?.success !== true) {
    const code = typeof result?.error === 'string' ? result.error : '';
    const status = ERROR_STATUS[code] ?? 500;
    const message =
      status === 500 ? 'Failed to file the correction' : ERROR_MESSAGE[code] ?? 'Invalid correction';
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    success: true,
    correction_id: result.correction_id ?? null,
  });
}
