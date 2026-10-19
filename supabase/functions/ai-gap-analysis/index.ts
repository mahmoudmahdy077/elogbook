import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { requirePrincipal, corsHeaders } from '../_shared/auth.ts';
import { findPhi, validateAiRequest, validateStructuredOutput } from '../_shared/ai-guard.ts';

const AI_BUDGET = {
  maxInputBytes: 8_192,
  maxOutputBytes: 16_384,
  maxInputTokens: 4_096,
  maxOutputTokens: 2_048,
  maxCostCents: 100,
  maxFanOut: 1,
} as const;

interface GapAnalysisRequest {
  resident_id: string;
}

interface GapResult {
  competency: string;
  current: number;
  target: number;
  gap: number;
  recommendation: string;
}

type GapCase = { case_templates?: { specialty?: string | null } | null };
type GapMilestone = { competency_area: string; level: number };
type GapGoal = { target_count: number; goal_progress?: Array<{ current_count?: number | null }> | null };

function safeGapLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const label = value.trim();
  if (label.length === 0 || label.length > 64 || findPhi(label).length > 0) return fallback;
  return /^[A-Za-z0-9][A-Za-z0-9 _./+()-]{0,63}$/.test(label) ? label : fallback;
}

serve(async (req) => {
  const headers = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const auth = await requirePrincipal(req, {
      roles: ['supervisor', 'director', 'institution_admin', 'admin'],
      aal: 'aal2',
    });
    if (auth instanceof Response) return auth;
    const { supabase, tenantId, role, principal } = auth;

    let body: GapAnalysisRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (Object.keys(body).some((key) => key !== 'resident_id')) {
      return new Response(JSON.stringify({ error: 'AI request contains unsupported fields' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    const { resident_id } = body;
    if (!resident_id || typeof resident_id !== 'string') {
      return new Response(JSON.stringify({ error: 'resident_id required' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const aiRequest = validateAiRequest(
      {
        tenant_id: tenantId,
        actor_id: principal.profileId,
        action: 'ai:gap-analysis',
        input: 'gap-analysis',
        resident_id,
        field_values: { status: 'approved' },
      },
      { actorId: principal.profileId, tenantId, role, status: 'active', aal: principal.aal },
      { requireAal2: true, requireDeidentified: true, budget: AI_BUDGET },
    );
    if (!aiRequest.ok) {
      return new Response(JSON.stringify({ error: aiRequest.reason === 'budget_exceeded' ? 'AI request exceeds the allowed budget' : 'AI request is not authorized' }), {
        status: aiRequest.reason === 'budget_exceeded' ? 400 : 403, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Plan gate: AI features only if subscription_plans.features.ai = true (mirrors ai-insights)
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('subscription_plans!inner(features)')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .maybeSingle();
    const planFeatures = (sub as unknown as { subscription_plans?: { features?: Record<string, unknown> } | null })?.subscription_plans?.features ?? null;
    if (!planFeatures || planFeatures.ai !== true) {
      return new Response(JSON.stringify({ error: 'AI features not available on your plan' }), {
        status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const [casesRes, milestonesRes, goalsRes] = await Promise.all([
      supabase.from('case_entries').select('id, tenant_id, resident_id, template_id, status, case_templates!inner(specialty)')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId).is('deleted_at', null),
      supabase.from('milestones').select('id, tenant_id, resident_id, competency_area, level')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId),
      supabase.from('program_goals').select('id, tenant_id, resident_id, target_count, goal_progress(current_count)')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId),
    ]);

    const cases = casesRes.data || [];
    const milestones = milestonesRes.data || [];
    const goals = goalsRes.data || [];

    // Compute gaps from case volume by specialty
    const specialtyCounts: Record<string, number> = {};
    for (const c of cases) {
      const specialty = (c as GapCase).case_templates?.specialty || 'Unknown';
      specialtyCounts[specialty] = (specialtyCounts[specialty] || 0) + 1;
    }

    // Build gaps array from ACGME minimums (general targets)
    const gaps: GapResult[] = [];
    const acgmeMinimums: Record<string, number> = {
      'Internal Medicine': 100,
      'Surgery': 150,
      'Pediatrics': 75,
      'Obstetrics': 40,
      'Psychiatry': 50,
      'Family Medicine': 80,
      'Emergency Medicine': 120,
      'Neurology': 40,
      'Radiology': 60,
      'Anesthesiology': 100,
    };

    for (const [specialty, min] of Object.entries(acgmeMinimums)) {
      const current = specialtyCounts[specialty] || 0;
      if (current < min) {
        gaps.push({
          competency: specialty,
          current,
          target: min,
          gap: min - current,
          recommendation: `Log ${min - current} more ${specialty} cases. Consider a rotation in ${specialty} within the next 3 months.`,
        });
      }
    }

    // Add milestone gaps
    for (const m of milestones) {
      const milestone = m as unknown as GapMilestone;
      if (milestone.level < 3) {
        gaps.push({
          competency: safeGapLabel(milestone.competency_area, 'Competency gap'),
          current: milestone.level,
          target: 3,
          gap: 3 - milestone.level,
          recommendation: 'Complete the competency gap to level 3 and discuss it with your supervisor.',
        });
      }
    }

    for (const g of goals) {
      const goal = g as unknown as GapGoal;
      const current = goal.goal_progress?.[0]?.current_count || 0;
      if (current < goal.target_count) {
        gaps.push({
          competency: 'Program goal gap',
          current,
          target: goal.target_count,
          gap: goal.target_count - current,
          recommendation: `Complete ${goal.target_count - current} more progress units and review the goal with your supervisor.`,
        });
      }
    }

    // Summary
    const summary = gaps.length > 0
      ? `Found ${gaps.length} gaps. Top priority: ${gaps.slice(0, 3).map(g => `${g.competency} (${g.gap} remaining)`).join(', ')}.`
      : 'No significant gaps found. Resident is meeting all minimum requirements.';

    const output = validateStructuredOutput({ gaps: gaps.slice(0, 20), summary }, 'gap', AI_BUDGET);
    if (!output.ok) {
      return new Response(JSON.stringify({ error: 'AI response failed the output safety boundary' }), {
        status: 502, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(output.value), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Gap analysis unavailable' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
});
