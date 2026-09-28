import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';
import { clinicalCommandLog, correlationHeaders, resolveCorrelationId } from '@/lib/observability/correlation-id';
import { z } from 'zod';

/**
 * submit_case -- authenticated command handler.
 *
 * Design contract (docs/superpowers/specs/2026-09-23-clinical-core-remediation-design.md
 * sections 4.5, 6.1, 6.3, 7): the only route into `pending`. It never writes
 * case_entries directly; the database command owns the transition, the approval
 * requests, the audit row and the outbox row in one transaction.
 *
 * A `request_id` is mandatory so a retry replays the stored result instead of
 * creating a second approval request. When the tenant has no eligible reviewer
 * the command fails closed and the case stays a draft.
 */
const submitCaseSchema = z.object({
  request_id: z.string().trim().min(1).max(128),
  expected_status: z.enum(['draft', 'rejected']).nullish(),
}).strict();

const CODE_STATUS: Record<string, number> = {
  invalid_request: 400,
  forbidden: 403,
  no_eligible_reviewer: 403,
  not_found: 404,
  state_conflict: 409,
  idempotency_conflict: 409,
  internal_error: 500,
};

const CODE_MESSAGE: Record<string, string> = {
  invalid_request: 'Invalid request body',
  forbidden: 'You are not allowed to submit this case',
  no_eligible_reviewer:
    'This case was not submitted: your institution has no active supervisor or director to review it. Ask an administrator to assign a reviewer.',
  not_found: 'Case not found',
  state_conflict: 'This case has already moved on. Reload to see its current state.',
  idempotency_conflict: 'This request key was already used with different input.',
  internal_error: 'Could not submit this case. Please try again.',
};

function classify(result: Record<string, unknown>): string {
  const code = typeof result.code === 'string' ? result.code : '';
  if (code === 'no_eligible_reviewer' || result.error === 'no_eligible_reviewer') {
    return 'no_eligible_reviewer';
  }
  return code in CODE_STATUS ? code : 'internal_error';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const guarded = await guardRequest(request, submitCaseSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`submit-case:${ip}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  // AAL2 is not required to submit: this is a resident action. The database
  // command still requires an active profile, an active tenant and ownership.
  const supabase = await createServerSupabase();
  const security = await getSecurityContext(supabase);
  if (!security.ok) {
    const error =
      security.reason === 'unauthenticated' || security.reason === 'session_required' || security.reason === 'session_unavailable'
        ? 'Unauthorized'
        : security.reason === 'profile_not_found'
          ? 'Profile not found'
          : security.reason === 'tenant_not_found'
            ? 'Tenant not found'
            : 'Security context unavailable';
    return NextResponse.json({ error }, { status: security.status });
  }

  const { tenant } = security.context;
  const { tenant: tenantSlug, id: caseId } = await params;

  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  const { request_id: requestId, expected_status: expectedStatus } = guarded.data;

  // The correlation id is server-derived. The client-supplied `request_id` is
  // an idempotency key only and is never used as the correlation id.
  const correlationId = resolveCorrelationId(request.headers);
  const startedAt = Date.now();
  const logClinical = (resultCode: string) =>
    logger.info('clinical command', clinicalCommandLog({
      command: 'submit_case',
      caseId,
      tenantId: tenant.id,
      durationMs: Date.now() - startedAt,
      resultCode,
      correlationId,
    }));

  const { data, error } = await supabase.rpc('submit_case_command', {
    p_case_id: caseId,
    p_request_id: requestId,
    p_expected_status: expectedStatus ?? null,
  });

  if (error) {
    logger.error('submit_case command failed', error, { caseId, correlationId });
    logClinical('internal_error');
    return NextResponse.json(
      { error: CODE_MESSAGE.internal_error, success: false, code: 'internal_error' },
      { status: 500, headers: correlationHeaders(correlationId) },
    );
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.success !== true) {
    const code = classify(result);
    logClinical(code);
    return NextResponse.json(
      { error: CODE_MESSAGE[code], success: false, code },
      { status: CODE_STATUS[code], headers: correlationHeaders(correlationId) },
    );
  }

  logClinical(String(result.status ?? 'unknown'));

  return NextResponse.json(
    {
      success: true,
      case_id: result.case_id,
      status: result.status,
    },
    { headers: correlationHeaders(correlationId) },
  );
}
