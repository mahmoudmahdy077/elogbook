import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';

const saveCaseDraftSchema = z.object({
  request_id: z.string().trim().min(1).max(128),
  template_id: z.string().uuid(),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.string(), z.unknown()),
  accreditation_mappings: z.array(z.unknown()).default([]),
  is_deidentified: z.literal(true),
  patient_age_years: z.number().int().min(0).max(150).nullable().optional(),
}).strict();

const CODE_STATUS: Record<string, number> = {
  invalid_request: 400,
  invalid_column: 400,
  forbidden: 403,
  account_inactive: 403,
  tenant_suspended: 403,
  policy_denied: 403,
  not_found: 404,
  state_conflict: 409,
  idempotency_conflict: 409,
  required_field_missing: 422,
  internal_error: 500,
};

const CODE_MESSAGE: Record<string, string> = {
  invalid_request: 'Invalid case draft request',
  invalid_column: 'Invalid case draft request',
  forbidden: 'You are not allowed to create this case',
  account_inactive: 'Your account is not active',
  tenant_suspended: 'This program is not active',
  policy_denied: 'This case cannot be saved under the current data policy',
  not_found: 'Case template not found',
  state_conflict: 'This case request is already being processed. Please retry.',
  idempotency_conflict: 'This request key was already used with different input.',
  required_field_missing: 'Complete all required template fields',
  internal_error: 'Could not save the case draft. Please try again.',
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, saveCaseDraftSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 64 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`save-case-draft:${ip}`, 30);
  if (!allowed) return rateLimitResponse(retryAfter);

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

  const { tenant: tenantSlug } = await params;
  if (security.context.tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  const { request_id: requestId, ...payload } = guarded.data;
  const { data, error } = await supabase.rpc('save_case_draft_command', {
    p_request_id: requestId,
    p_payload: payload,
  });

  if (error) {
    logger.error('save_case_draft command failed', error, { requestId });
    return NextResponse.json(
      { error: CODE_MESSAGE.internal_error, success: false, code: 'internal_error' },
      { status: 500 },
    );
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.success !== true) {
    const code = typeof result.code === 'string' && result.code in CODE_STATUS
      ? result.code
      : 'internal_error';
    const body: Record<string, unknown> = {
      error: CODE_MESSAGE[code],
      success: false,
      code,
    };
    if (Array.isArray(result.missing_fields)) {
      body.missing_fields = result.missing_fields;
    }
    return NextResponse.json(body, { status: CODE_STATUS[code] });
  }

  return NextResponse.json({
    success: true,
    case_id: result.case_id,
    status: result.status,
  });
}
