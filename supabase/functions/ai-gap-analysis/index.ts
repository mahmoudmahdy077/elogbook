import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { authenticate } from '../_shared/auth.ts';

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = await authenticate(req);
    if (auth instanceof Response) return auth;
    const { supabase, tenantId, role } = auth;

    if (!['supervisor', 'director', 'institution_admin', 'admin'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: supervisor role or higher required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { resident_id }: GapAnalysisRequest = await req.json();
    if (!resident_id) {
      return new Response(JSON.stringify({ error: 'resident_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [casesRes, milestonesRes, goalsRes, dutyHoursRes] = await Promise.all([
      supabase.from('case_entries').select('id, tenant_id, resident_id, template_id, case_date, status, created_at, updated_at, case_templates!inner(specialty, name)')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId).is('deleted_at', null),
      supabase.from('milestones').select('id, tenant_id, resident_id, competency_area, sub_competency, level')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId),
      supabase.from('program_goals').select('id, tenant_id, resident_id, title, target_count, deadline, goal_progress(current_count)')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId),
      supabase.from('duty_periods').select('id, tenant_id, resident_id, shift_date, hours_worked, shift_type')
        .eq('resident_id', resident_id).eq('tenant_id', tenantId),
    ]);

    const cases = casesRes.data || [];
    const milestones = milestonesRes.data || [];
    const goals = goalsRes.data || [];
    const dutyHours = dutyHoursRes.data || [];

    // Compute gaps from case volume by specialty
    const specialtyCounts: Record<string, number> = {};
    for (const c of cases) {
      const specialty = (c as any).case_templates?.specialty || 'Unknown';
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
      const milestone = m as any;
      if (milestone.level < 3) {
        gaps.push({
          competency: `${milestone.competency_area}: ${milestone.sub_competency}`,
          current: milestone.level,
          target: 3,
          gap: 3 - milestone.level,
          recommendation: `Seek assessments in ${milestone.sub_competency} to reach level 3. Discuss with supervisor at next evaluation.`,
        });
      }
    }

    // Add goal progress gaps
    for (const g of goals) {
      const goal = g as any;
      const current = goal.goal_progress?.[0]?.current_count || 0;
      if (current < goal.target_count) {
        gaps.push({
          competency: `Goal: ${goal.title}`,
          current,
          target: goal.target_count,
          gap: goal.target_count - current,
          recommendation: `Complete ${goal.target_count - current} more by ${goal.deadline}. Current pace: ${Math.round(current / Math.max(1, goal.target_count) * 100)}%.`,
        });
      }
    }

    // Summary
    const summary = gaps.length > 0
      ? `Found ${gaps.length} gaps. Top priority: ${gaps.slice(0, 3).map(g => `${g.competency} (${g.gap} remaining)`).join(', ')}.`
      : 'No significant gaps found. Resident is meeting all minimum requirements.';

    return new Response(JSON.stringify({ gaps: gaps.slice(0, 20), summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
