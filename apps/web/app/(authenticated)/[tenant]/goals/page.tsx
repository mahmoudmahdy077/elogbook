import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import GoalForm from '@/components/GoalForm';
import EmptyState from '@/components/EmptyState';
import ErrorDisplay from '@/components/ErrorDisplay';

interface GoalRow {
  id: string;
  title: string;
  target_count: number;
  deadline: string;
  specialty: string | null;
  description: string | null;
  goal_progress: { current_count: number } | null;
  profiles: { full_name: string } | null;
}

export default async function GoalsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  const isDirector = ['director', 'institution_admin', 'admin'].includes(auth.profile.role);

  const supabase = await createServerSupabase();
  let goalsQuery = supabase
    .from('program_goals')
    .select('*, goal_progress(current_count), profiles!resident_id(full_name)')
    .eq('tenant_id', auth.profile.tenant_id);

  if (!isDirector) {
    goalsQuery = goalsQuery.eq('resident_id', auth.profile.id);
  }

  const { data: goals, error: goalsError } = await goalsQuery.order('created_at', { ascending: false });

  if (goalsError) {
    return <ErrorDisplay message={goalsError.message} />;
  }

  let residents: { id: string; full_name: string }[] = [];
  if (isDirector) {
    const { data: residentsData, error: residentsError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', auth.profile.tenant_id);
    if (residentsError) {
      return <ErrorDisplay message={residentsError.message} />;
    }
    residents = residentsData ?? [];
  }

  const typedGoals = (goals ?? []) as GoalRow[];

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">
          {isDirector ? 'Resident Goals' : 'My Goals'}
        </h1>
        {isDirector && (
          <GoalForm
            tenantId={auth.profile.tenant_id}
            directorId={auth.profile.id}
            residents={residents}
          />
        )}
      </div>

      {!typedGoals || typedGoals.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-5 h-5 text-neutral-light/50" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
          }
          title={isDirector ? 'No goals set yet' : 'No goals assigned yet'}
          description={isDirector ? 'Create goals to track resident progress toward accreditation milestones.' : 'Your program director will assign goals to track your progress.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {typedGoals.map((goal) => {
            const current = goal.goal_progress?.current_count ?? 0;
            const target = goal.target_count as number;
            const percentage = Math.min(Math.round((current / target) * 100), 100);
            const isOverdue = new Date(goal.deadline) < new Date() && current < target;
            const isComplete = current >= target;

            let barColor: string;
            if (isComplete) barColor = 'bg-[#34C759]';
            else if (isOverdue) barColor = 'bg-[#FF3B30]';
            else barColor = 'bg-[#007AFF]';

            return (
              <div key={goal.id} className="panel">
                <div className="pb-4 border-b border-border">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-lg font-semibold">{goal.title}</h3>
                    {isDirector && (
                      <p className="text-sm text-text-muted">
                        {(goal.profiles)?.full_name}
                      </p>
                    )}
                  </div>
                </div>
                <div className="pt-4">
                  <div className="flex flex-col gap-2">
                    {goal.specialty && (
                      <p className="text-sm text-text-muted">Specialty: {goal.specialty}</p>
                    )}
                    <p className="text-sm text-text-muted clinical-data">
                      Deadline: {new Date(goal.deadline).toLocaleDateString()}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 w-full bg-default-200 rounded-full h-2.5">
                        <div
                          className={`${barColor} h-2.5 rounded-full transition-all duration-300`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-muted clinical-data shrink-0">
                        {current} / {target}
                      </span>
                    </div>
                    {isComplete && (
                      <p className="text-[#34C759] text-sm font-medium">Goal completed!</p>
                    )}
                    {isOverdue && (
                      <p className="text-[#FF3B30] text-sm font-medium">Overdue</p>
                    )}
                    {goal.description && (
                      <p className="text-sm text-text-muted mt-1">{goal.description}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
