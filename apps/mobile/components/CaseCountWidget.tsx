import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Svg from 'react-native-svg';
import { clinicalTokens } from '@elogbook/shared';
import type { TodayStats } from '../lib/today-stats';

const SvgCircle = Svg.Circle as any;
const SvgText = Svg.Text as any;

export interface CaseCountWidgetProps {
  stats: TodayStats;
  dailyGoal?: number;
}

/**
 * Apple Health–inspired card showing today's case count.
 *
 * Features a circular progress ring (today's total vs. daily goal)
 * and a breakdown by status (pending / approved / rejected).
 */
export function CaseCountWidget({ stats, dailyGoal = 10 }: CaseCountWidgetProps) {
  const percentage = dailyGoal > 0 ? Math.min((stats.total / dailyGoal) * 100, 100) : 0;
  const displayPercent = Math.round(percentage);

  return (
    <View style={styles.card}>
      {/* Header */}
      <Text
        style={styles.header}
        accessibilityRole="header"
      >
        Today&apos;s Cases
      </Text>

      <View style={styles.body}>
        {/* Circular progress ring */}
        <View style={styles.ringContainer}>
          <ProgressRing percentage={displayPercent} size={104} strokeWidth={8} />
        </View>

        {/* Stats breakdown */}
        <View style={styles.statsList}>
          <StatRow label="Total Today" value={stats.total} color={clinicalTokens.colors.primary.DEFAULT} />
          <StatRow label="Pending" value={stats.pending} color={clinicalTokens.colors.pending} />
          <StatRow label="Approved" value={stats.approved} color={clinicalTokens.colors.approved} />
          <StatRow label="Rejected" value={stats.rejected} color={clinicalTokens.colors.rejected} />
        </View>
      </View>

      {/* Daily goal footer */}
      <View style={styles.goalRow}>
        <Text style={styles.goalText}>
          Daily goal: {stats.total}/{dailyGoal}
        </Text>
        <View style={styles.goalBar}>
          <View style={[styles.goalFill, { width: `${Math.min(percentage, 100)}%` }]} />
        </View>
      </View>
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────

/** Inline circular progress ring drawn with SVG. */
function ProgressRing({
  percentage,
  size,
  strokeWidth,
}: {
  percentage: number;
  size: number;
  strokeWidth: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentage / 100);
  const center = size / 2;
  const fontSize = size * 0.24;

  return (
    <Svg.Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background track */}
      <SvgCircle
        cx={center}
        cy={center}
        r={radius}
        stroke={clinicalTokens.colors.neutral.light}
        strokeWidth={strokeWidth}
        fill="none"
      />
      {/* Foreground arc */}
      <SvgCircle
        cx={center}
        cy={center}
        r={radius}
        stroke={clinicalTokens.colors.primary.DEFAULT}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        fill="none"
        rotation={-90}
        origin={`${center}, ${center}`}
      />
      {/* Percentage label */}
      <SvgText
        x={center}
        y={center + fontSize * 0.35}
        textAnchor="middle"
        fill={clinicalTokens.colors.text.primary}
        fontSize={fontSize}
        fontFamily={clinicalTokens.fonts.heading}
        fontWeight="600"
      >
        {Math.round(percentage)}%
      </SvgText>
    </Svg.Svg>
  );
}

/** A single row in the stats list: label + value + colour dot. */
function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.statRow}>
      <View style={styles.statLabelRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: clinicalTokens.radius.lg,
    padding: clinicalTokens.spacing.lg,
    marginBottom: clinicalTokens.spacing.md,
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    fontSize: 17,
    fontFamily: clinicalTokens.fonts.heading,
    fontWeight: '600',
    color: clinicalTokens.colors.text.primary,
    marginBottom: clinicalTokens.spacing.md,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ringContainer: {
    marginRight: clinicalTokens.spacing.lg,
  },
  statsList: {
    flex: 1,
    gap: clinicalTokens.spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statLabel: {
    fontSize: 14,
    fontFamily: clinicalTokens.fonts.body,
    color: clinicalTokens.colors.text.secondary,
  },
  statValue: {
    fontSize: 15,
    fontFamily: clinicalTokens.fonts.mono,
    fontWeight: '600',
  },
  goalRow: {
    marginTop: clinicalTokens.spacing.md,
    paddingTop: clinicalTokens.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: clinicalTokens.colors.border.DEFAULT,
  },
  goalText: {
    fontSize: 13,
    fontFamily: clinicalTokens.fonts.body,
    color: clinicalTokens.colors.text.muted,
    marginBottom: 6,
  },
  goalBar: {
    height: 4,
    borderRadius: 2,
    backgroundColor: clinicalTokens.colors.neutral.light,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: clinicalTokens.colors.primary.DEFAULT,
  },
});
