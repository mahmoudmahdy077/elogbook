/**
 * POST /api/mobile/v1/cases/[id]/submit
 *
 * The Expo app's submit path. It authenticates the Supabase bearer token and
 * then runs the exact same case-submit core as the web route, so a case
 * submitted from the phone creates supervisor approval rows, dispatches the
 * `case.submitted` webhook and sends the pending-approval push. Before this
 * route the app inserted `status='pending'` directly and skipped all three.
 *
 * The case id is the only input; ownership, tenant, draft state and
 * subscription are enforced by the shared core and the database RPC.
 */

import { authenticateMobileRequest } from '@/lib/supabase/mobile-auth';
import { submitDraftEntry } from '@/lib/cases/submit-entry';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMobileRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid case id' }, { status: 400 });
  }

  const { allowed, retryAfter } = await checkRateLimit(
    `mobile-cases-submit:${auth.user.id}:${id}`,
    20,
  );
  if (!allowed) return rateLimitResponse(retryAfter);

  const result = await submitDraftEntry(auth.supabase, auth.user, id);
  return NextResponse.json(result.body, { status: result.status });
}
