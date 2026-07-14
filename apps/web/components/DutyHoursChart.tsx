'use client';

interface DutyPeriod {
  shift_date: string;
  hours_worked: number;
  shift_type: 'call' | 'clinic' | 'vacation' | 'weekend' | 'regular';
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysInWeek(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export default function DutyHoursChart({ periods }: { periods: DutyPeriod[] }) {
  const today = new Date();
  const latestWeekStart = getWeekStart(today);
  const days = getDaysInWeek(latestWeekStart);
  const periodMap = new Map<string, number>();
  for (const p of periods) {
    const curr = periodMap.get(p.shift_date) || 0;
    periodMap.set(p.shift_date, curr + (p.hours_worked || 0));
  }

  const totalWeek = days.reduce((sum, d) => {
    const key = d.toISOString().split('T')[0];
    return sum + (periodMap.get(key) || 0);
  }, 0);

  const isViolation = totalWeek > 80;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Week of {latestWeekStart.toISOString().split('T')[0]}</h3>
        {isViolation && <span className="px-2 py-1 text-xs bg-danger text-white rounded">Violation: {totalWeek}h &gt; 80h</span>}
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center font-medium text-neutral-light">{d}</div>
        ))}
        {days.map((day) => {
          const key = day.toISOString().split('T')[0];
          const hours = periodMap.get(key) || 0;
          return (
            <div key={key} className="bg-neutral-dark rounded p-1 text-center" title={`${key}: ${hours}h`}>
              <div className="h-12 bg-primary rounded" style={{ opacity: hours > 0 ? 0.8 : 0.2, height: '2rem' }} />
              <span className="text-[10px] mt-1 block">{hours}h</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span>Total: <strong>{totalWeek}h</strong></span>
        <span>Avg/day: <strong>{(totalWeek / 7).toFixed(1)}h</strong></span>
      </div>
    </div>
  );
}