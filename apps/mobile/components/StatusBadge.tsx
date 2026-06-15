import React from 'react';
import { View, Text } from 'react-native';

type StatusType = 'draft' | 'pending' | 'approved' | 'rejected';

interface StatusBadgeProps {
  status: StatusType;
}

const STATUS_STYLES: Record<StatusType, { bg: string; border: string; text: string; label: string; shadow: string }> = {
  draft: {
    bg: 'bg-slate-500/10',
    border: 'border-slate-500/30',
    text: 'text-slate-400',
    label: 'Draft',
    shadow: '',
  },
  pending: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    label: 'Pending',
    shadow: 'shadow-amber-500/20',
  },
  approved: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    label: 'Approved',
    shadow: 'shadow-emerald-500/20',
  },
  rejected: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    label: 'Rejected',
    shadow: 'shadow-red-500/20',
  },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <View className={`rounded-full px-3 py-0.5 border ${s.bg} ${s.border} ${s.shadow}`}>
      <Text className={`text-xs font-semibold uppercase ${s.text}`}>{s.label}</Text>
    </View>
  );
}
