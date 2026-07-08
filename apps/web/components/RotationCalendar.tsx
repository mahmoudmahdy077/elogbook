'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Rotation {
  id: string;
  title: string;
  specialty: string;
  start_date: string;
  end_date: string;
  site: string | null;
  resident_id: string;
  profiles?: { full_name: string } | null;
}

interface RotationCalendarProps {
  rotations: Rotation[];
  tenantSlug: string;
  canEdit: boolean;
  residents?: { id: string; full_name: string }[];
  selectedResidentId?: string | null;
}

const ROTATION_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-rose-500',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export default function RotationCalendar({
  rotations,
  tenantSlug,
  canEdit,
  residents,
  selectedResidentId,
}: RotationCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedRotation, setSelectedRotation] = useState<Rotation | null>(null);
  const [residentFilter, setResidentFilter] = useState<string>(
    selectedResidentId ?? ''
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const filteredRotations = useMemo(() => {
    let result = rotations;
    if (residentFilter) {
      result = result.filter((r) => r.resident_id === residentFilter);
    }
    return result;
  }, [rotations, residentFilter]);

  const prevMonth = () =>
    setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () =>
    setCurrentDate(new Date(year, month + 1, 1));

  const monthStart = formatDate(year, month, 1);
  const monthEnd = formatDate(year, month, daysInMonth);

  const visibleRotations = filteredRotations.filter((r) => {
    return r.start_date <= monthEnd && r.end_date >= monthStart;
  });

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push(d);
  }

  // Group by rotation for multi-day spans
  const rotationSpanMap = new Map<string, { rotation: Rotation; startDay: number; endDay: number }[]>();
  for (const rot of visibleRotations) {
    const rotStart = new Date(rot.start_date);
    const rotEnd = new Date(rot.end_date);
    let startDay = rotStart.getDate();
    let endDay = rotEnd.getDate();

    // Clamp to visible month
    if (rotStart.getFullYear() < year || (rotStart.getFullYear() === year && rotStart.getMonth() < month)) {
      startDay = 1;
    }
    if (rotEnd.getFullYear() > year || (rotEnd.getFullYear() === year && rotEnd.getMonth() > month)) {
      endDay = daysInMonth;
    }

    if (rotStart.getFullYear() === year && rotStart.getMonth() === month && rotEnd.getFullYear() === year && rotEnd.getMonth() === month) {
      // Same month
      for (let d = startDay; d <= endDay; d++) {
        const key = String(d);
        if (!rotationSpanMap.has(key)) rotationSpanMap.set(key, []);
        rotationSpanMap.get(key)!.push({ rotation: rot, startDay, endDay });
      }
    }
  }

  // For multi-day continuous bars, track per-column
  const columnSpans: { col: number; rotation: Rotation; length: number }[] = [];
  const columnMap = new Map<string, { rotation: Rotation; col: number; length: number }[]>();

  for (const rot of visibleRotations) {
    const rotStart = new Date(rot.start_date);
    const rotEnd = new Date(rot.end_date);

    let sDay = rotStart.getMonth() === month && rotStart.getFullYear() === year ? rotStart.getDate() : 1;
    let eDay = rotEnd.getMonth() === month && rotEnd.getFullYear() === year ? rotEnd.getDate() : daysInMonth;

    // Clamp
    if (rotStart < new Date(year, month, 1)) sDay = 1;
    if (rotEnd > new Date(year, month, daysInMonth)) eDay = daysInMonth;

    if (eDay >= sDay) {
      const col = sDay + firstDay - 1;
      const length = eDay - sDay + 1;
      columnSpans.push({ col, rotation: rot, length });

      for (let d = sDay; d <= eDay; d++) {
        const key = String(d);
        if (!columnMap.has(key)) columnMap.set(key, []);
        columnMap.get(key)!.push({ rotation: rot, col: d + firstDay - 1, length: eDay - sDay + 1 });
      }
    }
  }

  // Build day-level rotation info
  const dayRotations = new Map<number, { rotation: Rotation; color: string }[]>();
  let colorIndex = 0;
  const rotationColorMap = new Map<string, string>();
  for (const rot of visibleRotations) {
    if (!rotationColorMap.has(rot.id)) {
      rotationColorMap.set(rot.id, ROTATION_COLORS[colorIndex % ROTATION_COLORS.length]);
      colorIndex++;
    }
  }

  for (const rot of visibleRotations) {
    const rotStart = new Date(rot.start_date);
    const rotEnd = new Date(rot.end_date);

    const startDay = rotStart.getMonth() === month && rotStart.getFullYear() === year ? rotStart.getDate() : 1;
    const endDay = rotEnd.getMonth() === month && rotEnd.getFullYear() === year ? rotEnd.getDate() : daysInMonth;

    const sDay = Math.max(1, startDay);
    const eDay = Math.min(daysInMonth, endDay);

    for (let d = sDay; d <= eDay; d++) {
      if (!dayRotations.has(d)) dayRotations.set(d, []);
      dayRotations.get(d)!.push({
        rotation: rot,
        color: rotationColorMap.get(rot.id) || 'bg-blue-500',
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Month navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="rounded-full p-2 hover:bg-neutral-dark transition-colors"
            aria-label="Previous month"
          >
            <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-text-primary min-w-[180px] text-center">
            {MONTH_NAMES[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="rounded-full p-2 hover:bg-neutral-dark transition-colors"
            aria-label="Next month"
          >
            <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Resident filter */}
          {residents && residents.length > 0 && (
            <select
              value={residentFilter}
              onChange={(e) => setResidentFilter(e.target.value)}
              className="rounded-xl bg-surface-solid border border-border p-2.5 text-sm"
              aria-label="Filter by resident"
            >
              <option value="">All Residents</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          )}

          {canEdit && (
            <a
              href={`/${tenantSlug}/rotations/new`}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              Add Rotation
            </a>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-surface-solid rounded-2xl border border-border overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border bg-neutral-dark">
          {DAY_NAMES.map((name) => (
            <div
              key={name}
              className="px-2 py-2.5 text-center text-xs font-semibold text-text-muted uppercase tracking-wider"
            >
              {name}
            </div>
          ))}
        </div>

        {/* Calendar body */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, i) => (
            <div
              key={i}
              className={`min-h-[80px] border-b border-r border-border p-1.5 ${
                day === null ? 'bg-neutral-dark/30' : 'bg-surface-solid'
              }`}
            >
              {day !== null && (
                <>
                  <span className="text-xs font-medium text-text-muted mb-1 block">
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {(dayRotations.get(day) ?? []).map(({ rotation, color }, idx) => (
                      <button
                        key={`${rotation.id}-${idx}`}
                        onClick={() => setSelectedRotation(rotation)}
                        className={`w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded ${color} text-white truncate hover:opacity-90 transition-opacity`}
                        title={`${rotation.title} (${rotation.specialty})`}
                      >
                        {rotation.title}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rotation Detail Modal */}
      <AnimatePresence>
        {selectedRotation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
            onClick={() => setSelectedRotation(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-lg glass-panel p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">
                    {selectedRotation.title}
                  </h3>
                  <p className="text-sm text-text-muted">
                    {selectedRotation.specialty}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedRotation(null)}
                  className="rounded-full p-1.5 hover:bg-neutral-dark transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-text-muted text-xs">Start Date</p>
                  <p className="text-text-primary font-medium">
                    {new Date(selectedRotation.start_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-xs">End Date</p>
                  <p className="text-text-primary font-medium">
                    {new Date(selectedRotation.end_date).toLocaleDateString()}
                  </p>
                </div>
                {selectedRotation.site && (
                  <div>
                    <p className="text-text-muted text-xs">Site</p>
                    <p className="text-text-primary font-medium">
                      {selectedRotation.site}
                    </p>
                  </div>
                )}
                {selectedRotation.profiles?.full_name && (
                  <div>
                    <p className="text-text-muted text-xs">Resident</p>
                    <p className="text-text-primary font-medium">
                      {selectedRotation.profiles.full_name}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <a
                  href={`/${tenantSlug}/rotations/${selectedRotation.id}`}
                  className="flex-1 text-center rounded-full bg-primary text-white px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  View Details
                </a>
                {canEdit && (
                  <a
                    href={`/${tenantSlug}/rotations/${selectedRotation.id}/edit`}
                    className="rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
                  >
                    Edit
                  </a>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
