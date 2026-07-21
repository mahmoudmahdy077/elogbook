'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import { useSubscriptionStatus } from '@/components/SubscriptionStatusProvider';
import { StatusBadge } from '@elogbook/shared/components/web';

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
  planSlug?: string;
}

/* ===== Apple Watch-Style KPI Ring ===== */
function KpiRing({ value, max, label, color, delay }: { value: number; max: number; label: string; color: string; delay: number }) {
  const [animated, setAnimated] = useState(false);
  const [animatedValue, setAnimatedValue] = useState(0);
  const size = 68;
  const strokeWidth = 4;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference * (1 - progress);

  useEffect(() => {
    const t1 = setTimeout(() => setAnimated(true), delay + 100);
    const t2 = setTimeout(() => setAnimatedValue(value), delay + 100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [value, delay]);

  return (
    <div
      className="bg-surface-solid rounded-2xl border border-border p-5 flex flex-col items-center gap-2.5"
      style={{ animation: `fadeSlideIn 0.35s ease-out ${delay * 0.001}s both` }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${label}: ${value} of ${max}`}>
          <title>{`${label}: ${value} of ${max}`}</title>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(60, 60, 67, 0.10)" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={animated ? offset : circumference}
            style={{ transition: `stroke-dashoffset 0.6s ease-out ${delay * 0.001 + 0.15}s` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-semibold text-text-primary tracking-tight font-sans">{animatedValue}</span>
        </div>
      </div>
      <span className="text-[0.75rem] font-medium text-text-muted uppercase tracking-wider">{label}</span>
    </div>
  );
}

/* ===== Progress Bar ===== */
function ProgressBar({ current, target, label }: { current: number; target: number; label: string }) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setAnimated(true);
  }, []);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-text-secondary font-medium truncate">{label}</span>
        <span className="text-text-muted font-medium font-mono">{current} / {target}</span>
      </div>
      <div className="h-1 rounded-full bg-neutral-dark overflow-hidden">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: animated ? `${pct}%` : '0%', transition: 'width 0.5s ease-out' }}
        />
      </div>
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Dashboard({ data }: { data: DashboardData }) {
  const { profile, tenantSlug, stats, recentCases, goals, residents, pendingApprovals, totalResidents, tenantType, residentViolations = [], directorViolations = [] } = data;
  const role = profile.role;
  const totalCases = stats.draft + stats.pending + stats.approved + stats.rejected;
  const { isReadOnly } = useSubscriptionStatus();

  return (
    <div className="space-y-7">
      {/* Header */}
      <div
        className="flex items-start justify-between"
        style={{ animation: 'fadeSlideIn 0.3s ease-out both' }}
      >
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em] font-sans">
            Welcome, {profile.full_name.split(' ')[0]}
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1 font-normal">
            {profile.specialty || 'Resident'} · {tenantType === 'individual' ? 'Individual Account' : profile.role === 'resident' ? 'Demo Hospital' : `${role === 'director' ? 'Program Director' : role === 'institution_admin' ? 'Institution Admin' : 'Supervisor'} Dashboard`}
          </p>
        </div>
        {role === 'resident' && (
          isReadOnly ? (
            <span className="px-4 py-2.5 rounded-full bg-neutral-dark text-text-muted text-sm font-medium cursor-not-allowed" aria-disabled="true">
              Logging disabled — renew subscription
            </span>
          ) : (
            <Link href={`/${tenantSlug}/cases/new`} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"/></svg>
              Log New Case
            </Link>
          )
        )}
      </div>

      {/* KPI Rings */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiRing value={stats.draft} max={totalCases || 1} label="Draft" color="#8E8E93" delay={60} />
        <KpiRing value={stats.pending} max={totalCases || 1} label="Pending" color="#FF9500" delay={120} />
        <KpiRing value={stats.approved} max={totalCases || 1} label="Approved" color="#34C759" delay={180} />
        <KpiRing value={stats.rejected} max={totalCases || 1} label="Rejected" color="#FF3B30" delay={240} />
      </div>

      {/* Upgrade prompt for Free plan near limit */}
      {data.planSlug === 'free' && totalCases >= 18 && totalCases < 20 && (
        <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
          <p className="text-sm font-medium text-text-primary mb-1">
            You&apos;re approaching your free limit ({totalCases}/20 cases)
          </p>
          <p className="text-xs text-text-muted mb-3">
            Upgrade for unlimited case logging and AI-powered insights.
          </p>
          <Link
            href={`/${tenantSlug}/billing`}
            className="inline-block px-4 py-1.5 rounded-full bg-primary text-white text-xs font-medium hover:opacity-90 transition-opacity"
          >
            View upgrade options
          </Link>
        </div>
      )}

      {/* Duty Hours Violations */}
      {(residentViolations.length > 0 || directorViolations.length > 0) && (
        <div
          className="p-4 rounded-2xl bg-danger-50 border border-danger/20"
          style={{ animation: 'fadeSlideIn 0.3s ease-out 0.3s both' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-danger" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495a.75.75 0 01.683.405l6.5 12.5a.75.75 0 01-1.268.76l-5.5-10.642-5.5 10.642a.75.75 0 01-1.268-.76l6.5-12.5a.75.75 0 01.683-.405z" clipRule="evenodd" />
            </svg>
            <h2 className="font-semibold text-text-primary text-sm">Duty Hour Violations</h2>
          </div>
          {profile.role === 'resident' && (
            <div className="space-y-1">
              {residentViolations.map((v) => (
                <p key={v.week_start} className="text-xs text-text-secondary">
                  Week of {v.week_start}: <span className="font-semibold">{v.total_hours}</span> hours
                </p>
              ))}
            </div>
          )}
          {(profile.role === 'director' || profile.role === 'institution_admin' || profile.role === 'admin') && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {directorViolations.map((v) => (
                <p key={`${v.resident_id}-${v.week_start}`} className="text-xs text-text-secondary">
                  {residents.find((r) => r.id === v.resident_id)?.full_name ?? 'Unknown'} — Week of {v.week_start}: <span className="font-semibold">{v.total_hours}</span> hours
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2-Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Cases */}
        <div
          className="bg-surface-solid rounded-2xl border border-border p-5"
          style={{ animation: 'fadeSlideIn 0.35s ease-out 0.2s both' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">Recent Cases</h2>
            {recentCases.length > 0 && (
              <Link href={`/${tenantSlug}/cases`} className="text-xs font-medium text-primary hover:opacity-80 transition-opacity">
                View All
              </Link>
            )}
          </div>
          {recentCases.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-5 h-5 text-text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5zM4.75 10.75a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 4.25a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" clipRule="evenodd" />
                </svg>
              }
              title="No cases logged yet"
              description="Start building your logbook by recording your first clinical case."
              action={{ label: 'Log your first case', href: `/${tenantSlug}/cases/new` }}
            />
          ) : (
            <div className="flex flex-col">
              {recentCases.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/${tenantSlug}/cases/${c.id}`}
                  className={`flex items-center justify-between py-2.5 -mx-5 px-5 hover:bg-primary/5 transition-colors ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary truncate">{c.template_specialty} — {c.template_name}</p>
                    <p className="text-xs text-text-muted mt-0.5">{formatRelativeDate(c.case_date)}</p>
                  </div>
                  <StatusBadge status={c.status} size="sm" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Right Column — Goals + Pending Approvals */}
        <div
          className="bg-surface-solid rounded-2xl border border-border p-5"
          style={{ animation: 'fadeSlideIn 0.35s ease-out 0.25s both' }}
        >
          {/* Resident: Goal Progress */}
          {role === 'resident' && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">Goal Progress</h2>
                {goals.length > 0 && (
                  <Link href={`/${tenantSlug}/goals`} className="text-xs font-medium text-primary hover:opacity-80 transition-opacity">
                    All Goals
                  </Link>
                )}
              </div>
              {goals.length === 0 ? (
                <EmptyState
                  title="No goals assigned yet"
                  description="Goals track your progress toward accreditation milestones."
                  action={{ label: 'View goals', href: `/${tenantSlug}/goals` }}
                />
              ) : (
                <div className="space-y-4">
                  {goals.map((g) => (
                    <ProgressBar key={g.id} current={g.current} target={g.target} label={g.title} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Supervisor+/Director+: Pending Approvals */}
          {(role === 'supervisor' || role === 'director' || role === 'institution_admin' || role === 'admin') && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">Pending Approvals</h2>
                {pendingApprovals > 0 && (
                  <Link href={`/${tenantSlug}/approvals`} className="text-xs font-medium text-primary hover:opacity-80 transition-opacity">
                    Review All
                  </Link>
                )}
              </div>
              {pendingApprovals === 0 ? (
                <EmptyState title="All caught up" description="No cases are currently awaiting your review." />
              ) : (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-warning-50">
                  <span className="text-2xl font-semibold text-warning tracking-tight">{pendingApprovals}</span>
                  <div>
                    <p className="text-sm font-medium text-text-primary">Cases awaiting review</p>
                    <p className="text-xs text-text-muted mt-0.5">Review and approve or reject</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Director+/Admin: Resident Overview */}
          {(role === 'director' || role === 'institution_admin' || role === 'admin') && tenantType === 'institution' && (
            <div className="mt-5 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text-primary">Resident Overview</h3>
                <span className="text-xs text-text-muted">{totalResidents} residents</span>
              </div>
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {residents.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs py-1.5 px-1 rounded-lg hover:bg-neutral-dark">
                    <div className="truncate flex-1">
                      <span className="font-medium text-text-primary">{r.full_name}</span>
                      <span className="text-text-muted ml-1">{r.specialty || ''}</span>
                    </div>
                    <span className="text-text-muted font-medium">{r.approved}/{r.total_cases}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        style={{ animation: 'fadeSlideIn 0.35s ease-out 0.35s both' }}
      >
        <Link href={`/${tenantSlug}/cases`} className="bg-surface-solid rounded-2xl border border-border p-4 text-center text-sm transition-all duration-200 hover:border-primary flex flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group">
          <svg className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5z"/>
          </svg>
          <span className="text-xs font-medium text-text-secondary group-hover:text-primary transition-colors">Cases</span>
        </Link>
        {role !== 'resident' && (
          <Link href={`/${tenantSlug}/approvals`} className="bg-surface-solid rounded-2xl border border-border p-4 text-center text-sm transition-all duration-200 hover:border-primary flex flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group">
            <svg className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"/>
            </svg>
            <span className="text-xs font-medium text-text-secondary group-hover:text-primary transition-colors">Approvals</span>
          </Link>
        )}
        <Link href={`/${tenantSlug}/goals`} className="bg-surface-solid rounded-2xl border border-border p-4 text-center text-sm transition-all duration-200 hover:border-primary flex flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group">
          <svg className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"/>
          </svg>
          <span className="text-xs font-medium text-text-secondary group-hover:text-primary transition-colors">Goals</span>
        </Link>
        <Link href={`/${tenantSlug}/reports`} className="bg-surface-solid rounded-2xl border border-border p-4 text-center text-sm transition-all duration-200 hover:border-primary flex flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group">
          <svg className="w-5 h-5 text-text-muted group-hover:text-primary transition-colors" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z"/>
          </svg>
          <span className="text-xs font-medium text-text-secondary group-hover:text-primary transition-colors">Reports</span>
        </Link>
      </div>
    </div>
  );
}