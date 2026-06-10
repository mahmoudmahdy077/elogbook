import { createServerSupabase } from '@/lib/supabase/server';
import { Card, ProgressBar } from '@heroui/react';
import GoalForm from '@/components/GoalForm';

export default async function GoalsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user!.id)
    .single();

  if (!profile) return null;

  const isDirector = ['director', 'institution_admin', 'admin'].includes(profile.role);

  let goalsQuery = supabase
    .from('program_goals')
    .select('*, goal_progress(current_count), profiles!program_goals_resident_id_fkey(full_name)')
    .eq('tenant_id', profile.tenant_id);

  if (!isDirector) {
    goalsQuery = goalsQuery.eq('resident_id', profile.id);
  }

  const { data: goals } = await goalsQuery.order('created_at', { ascending: false });

  let residents: { id: string; full_name: string }[] = [];
  if (isDirector) {
    const { data: residentsData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', profile.tenant_id);
    residents = residentsData ?? [];
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">
          {isDirector ? 'Resident Goals' : 'My Goals'}
        </h1>
        {isDirector && (
          <GoalForm
            tenantId={profile.tenant_id}
            directorId={profile.id}
            residents={residents}
          />
        )}
      </div>

      {!goals || goals.length === 0 ? (
        <p className="text-default-500">No goals set yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((goal: any) => {
            const current = goal.goal_progress?.current_count ?? 0;
            const target = goal.target_count as number;
            const percentage = Math.min(Math.round((current / target) * 100), 100);
            const isOverdue = new Date(goal.deadline) < new Date() && current < target;
            const isComplete = current >= target;

            let color: 'success' | 'danger' | 'primary' = 'primary';
            if (isComplete) color = 'success';
            else if (isOverdue) color = 'danger';

            return (
              <Card key={goal.id} className="glass-panel">
                <Card.Header>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-lg font-semibold">{goal.title}</h3>
                    {isDirector && (
                      <p className="text-sm text-default-500">
                        {(goal.profiles as any)?.full_name}
                      </p>
                    )}
                  </div>
                </Card.Header>
                <Card.Content>
                  <div className="flex flex-col gap-2">
                    {goal.specialty && (
                      <p className="text-sm text-default-500">Specialty: {goal.specialty}</p>
                    )}
                    <p className="text-sm text-default-500 clinical-data">
                      Deadline: {new Date(goal.deadline).toLocaleDateString()}
                    </p>
                    <div className="flex items-center gap-2 clinical-data">
                      <ProgressBar value={percentage} color={color} className="flex-1">
                        <ProgressBar.Output>{current} / {target}</ProgressBar.Output>
                      </ProgressBar>
                    </div>
                    {isComplete && (
                      <p className="text-success text-sm font-medium">Goal completed!</p>
                    )}
                    {isOverdue && (
                      <p className="text-danger text-sm font-medium">Overdue</p>
                    )}
                    {goal.description && (
                      <p className="text-sm text-default-400 mt-1">{goal.description}</p>
                    )}
                  </div>
                </Card.Content>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
