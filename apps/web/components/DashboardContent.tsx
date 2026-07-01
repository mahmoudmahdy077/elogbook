'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import { useSubscriptionStatus } from '@/components/SubscriptionStatusProvider';

type Role = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';
type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';

interface Stats {
  draft: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface RecentCase {
  id: string;
  case_date: string;
  status: CaseStatus;
  template_name: string;
  template_specialty: string;
}

interface GoalSummary {
  id: string;
  title: string;
  current: number;
  target: number;
  deadline: string;
  specialty: string | null;
}

interface ResidentSummary {
  id: string;
  full_name: string;
  specialty: string | null;
  total_cases: number;
  approved: number;
}

interface ViolationRow {
  resident_id?: string;
  week_start: string;
  total_hours: number;
}

interface DashboardData {
  profile: { id: string; role: Role; full_name: string; specialty: string | null; tenant_id: string };
  tenantSlug: string;
  stats: Stats;
  recentCases: RecentCase[];
  goals: GoalSummary[];
  residents: ResidentSummary[];
  pendingApprovals: number;
  totalResidents: number;
  tenantType: 'individual' | 'institution';
  residentViolations?: ViolationRow[];
  directorViolations?: ViolationRow[];
}

function KpiRing({ value, max, label, color, delay }: { value: number; max: number; label: string; color: string; delay: number }) {
  const [animatedValue, setAnimatedValue] = useState(0);
  const reduceMotion = useReducedMotion();
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference * (1 - progress);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedValue(value), delay + 200);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: delay * 0.001, ease: 'easeOut' }}
      className="panel p-4 flex flex-col items-center gap-2 transition-shadow duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5"
    >
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90" role="img" aria-label={`${label}: ${value} of ${max}`}>
        <title>{`${label}: ${value} of ${max}`}</title>
        <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--color-neutral-dark)" strokeWidth="6" />
        <motion.circle
          cx="44" cy="44" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.8, delay: delay * 0.001 + 0.2, ease: 'easeOut' }}
          style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
        />
      </svg>
      <div className="text-center">
        <p className="text-2xl font-bold text-[var(--color-text-primary)]">{animatedValue}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: CaseStatus }) {
  const map: Record<CaseStatus, string> = {
    draft: 'badge-draft',
    pending: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
  };
  return <span className={`${map[status]} px-2 py-0.5 text-xs font-semibold rounded`}>{status}</span>;
}

function ProgressBar({ current, target, label }: { current: number; target: number; label: string }) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const reduceMotion = useReducedMotion();
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-light/60 truncate">{label}</span>
        <span className="clinical-data">{current}/{target}</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-dark border border-border overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: pct >= 100 ? 'var(--color-emerald-glow)' : 'var(--color-primary)' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

export default function Dashboard({ data }: { data: DashboardData }) {
  const { profile, tenantSlug, stats, recentCases, goals, residents, pendingApprovals, totalResidents, tenantType, residentViolations = [], directorViolations = [] } = data;
  const role = profile.role;
  const totalCases = stats.draft + stats.pending + stats.approved + stats.rejected;
  const { isReadOnly } = useSubscriptionStatus();
  const reduceMotion = useReducedMotion();

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-heading font-bold text-[var(--color-text-primary)]">Welcome, {profile.full_name}</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {role === 'resident' && `${profile.specialty || 'Resident'} — ${tenantType === 'individual' ? 'Individual Account' : 'Institution'}`}
            {role === 'supervisor' && 'Supervisor Dashboard'}
            {(role === 'director' || role === 'institution_admin' || role === 'admin') && 'Program Director Dashboard'}
          </p>
        </div>
        {role === 'resident' && (
          isReadOnly ? (
            <span className="px-4 py-2.5 rounded-lg bg-neutral-dark text-text-muted text-sm font-medium cursor-not-allowed" aria-disabled="true">
              Logging disabled — renew subscription
            </span>
          ) : (
            <Link href={`/${tenantSlug}/cases/new`} className="px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow">
              + Log New Case
            </Link>
          )
        )}
      </motion.div>

{/* KPI Rings */}
       <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
         <KpiRing value={stats.draft} max={totalCases || 1} label="Draft" color="var(--color-neutral-light)" delay={100} />
         <KpiRing value={stats.pending} max={totalCases || 1} label="Pending" color="var(--color-pending)" delay={200} />
         <KpiRing value={stats.approved} max={totalCases || 1} label="Approved" color="var(--color-approved)" delay={300} />
         <KpiRing value={stats.rejected} max={totalCases || 1} label="Rejected" color="var(--color-rejected)" delay={400} />
       </div>

       {/* Duty Hours Violations */}
       {(residentViolations.length > 0 || directorViolations.length > 0) && (
         <motion.div
           initial={{ opacity: 0, y: 16 }}
           animate={{ opacity: 1, y: 0 }}
           transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.4 }}
           className="panel p-4 border border-rejected/30 bg-[rgba(239,68,68,0.08)]"
         >
           <div className="flex items-center gap-2 mb-3">
             <svg className="w-5 h-5 text-rejected" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
               <path fillRule="evenodd" d="M8.485 2.495a.75.75 0 01.683.405l6.5 12.5a.75.75 0 01-1.268.76l-5.5-10.642-5.5 10.642a.75.75 0 01-1.268-.76l6.5-12.5a.75.75 0 01.683-.405z" clipRule="evenodd" />
             </svg>
             <h2 className="font-heading font-semibold text-[var(--color-text-primary)]">Duty Hour Violations</h2>
           </div>
           {profile.role === 'resident' && (
             <div className="space-y-1.5">
               {residentViolations.map((v) => (
                 <p key={v.week_start} className="text-xs">
                   Week of {v.week_start}: <span className="font-medium">{v.total_hours}</span> hours
                 </p>
               ))}
             </div>
           )}
           {(profile.role === 'director' || profile.role === 'institution_admin' || profile.role === 'admin') && (
             <div className="space-y-1.5 max-h-40 overflow-y-auto">
               {directorViolations.map((v) => (
                 <p key={`${v.resident_id}-${v.week_start}`} className="text-xs">
                   {residents.find((r) => r.id === v.resident_id)?.full_name ?? 'Unknown'} — Week of {v.week_start}: <span className="font-medium">{v.total_hours}</span> hours
                 </p>
               ))}
             </div>
           )}
         </motion.div>
       )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Cases */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.3 }}
          className="panel p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5"
        >
          <h2 className="font-heading font-semibold mb-3 text-[var(--color-text-primary)]">Recent Cases</h2>
          {recentCases.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-5 h-5 text-neutral-light/50" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5zM4.75 10.75a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 4.25a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" clipRule="evenodd" />
                </svg>
              }
              title="No cases logged yet"
              description="Start building your logbook by recording your first clinical case."
              action={{
                label: 'Log your first case',
                href: `/${tenantSlug}/cases/new`,
              }}
            />
          ) : (
            <div className="space-y-2">
              {recentCases.map((c) => (
                <Link key={c.id} href={`/${tenantSlug}/cases/${c.id}`} className="flex items-center justify-between p-2 rounded-lg hover:bg-neutral-dark/50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{c.template_specialty} — {c.template_name}</p>
                    <p className="text-xs text-neutral-light/50 clinical-data">{c.case_date}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </Link>
              ))}
            </div>
          )}
        </motion.div>

        {/* Goals / Residents / Approvals — role-specific */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.4 }}
          className="panel p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5"
        >
          {/* Resident: Goal Progress */}
          {role === 'resident' && (
            <>
              <h2 className="font-heading font-semibold mb-3 text-[var(--color-text-primary)]">Goal Progress</h2>
              {goals.length === 0 ? (
                <EmptyState
                  title="No goals assigned yet"
                  description="Goals track your progress toward accreditation milestones. Your program director assigns them."
                  action={{
                    label: 'View goals',
                    href: `/${tenantSlug}/goals`,
                  }}
                />
              ) : (
                <div className="space-y-3">
                  {goals.map((g) => (
                    <ProgressBar key={g.id} current={g.current} target={g.target} label={g.title} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Supervisor: Pending Approvals */}
          {(role === 'supervisor' || role === 'director' || role === 'institution_admin' || role === 'admin') && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-heading font-semibold text-[var(--color-text-primary)]">Pending Approvals</h2>
                {pendingApprovals > 0 && (
                  <Link href={`/${tenantSlug}/approvals`} className="text-xs text-primary hover:underline">
                    Review all →
                  </Link>
                )}
              </div>
              {pendingApprovals === 0 ? (
                <EmptyState
                  title="All caught up"
                  description="No cases are currently awaiting your review."
                />
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[rgba(245,158,11,0.08)] border border-pending/20">
                  <div className="w-10 h-10 rounded-full bg-[rgba(245,158,11,0.15)] flex items-center justify-center">
                    <span className="clinical-data text-pending font-bold">{pendingApprovals}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Cases awaiting review</p>
                    <p className="text-xs text-neutral-light/50">Review and approve or reject</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Director/Admin: Resident Overview */}
          {(role === 'director' || role === 'institution_admin' || role === 'admin') && tenantType === 'institution' && (
            <div className="mt-4">
              <h3 className="font-heading font-semibold text-sm mb-2 text-[var(--color-text-primary)]">Resident Overview</h3>
              <p className="text-xs text-neutral-light/50 mb-2">{totalResidents} residents in program</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {residents.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-neutral-dark/30">
                    <div className="truncate">
                      <span className="font-medium">{r.full_name}</span>
                      <span className="text-neutral-light/50 ml-1">{r.specialty || ''}</span>
                    </div>
                    <span className="clinical-data text-neutral-light/50">{r.approved}/{r.total_cases}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick Links */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 0.5 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <Link href={`/${tenantSlug}/cases`} className="panel p-3 text-center text-sm transition-all duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5 flex flex-col items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow">
          <svg className="w-5 h-5 text-neutral-light/60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5zM4.75 10.75a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 4.25a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" clipRule="evenodd" />
          </svg>
          Cases
        </Link>
        {role !== 'resident' && (
          <Link href={`/${tenantSlug}/approvals`}             className="panel p-3 text-center text-sm transition-all duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5 flex flex-col items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow">
          <svg className="w-5 h-5 text-neutral-light/60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
            Approvals
          </Link>
        )}
        <Link href={`/${tenantSlug}/goals`}             className="panel p-3 text-center text-sm transition-all duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5 flex flex-col items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow">
          <svg className="w-5 h-5 text-neutral-light/60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          Goals
        </Link>
        <Link href={`/${tenantSlug}/reports`}             className="panel p-3 text-center text-sm transition-all duration-200 hover:shadow-[var(--shadow-primary)] hover:-translate-y-0.5 flex flex-col items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow">
          <svg className="w-5 h-5 text-neutral-light/60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />
          </svg>
          Reports
        </Link>
      </motion.div>
    </div>
  );
}
