import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { clinicalTokens } from '@elogbook/shared';

type StatusType = 'draft' | 'pending' | 'approved' | 'rejected';

interface StatusBadgeProps {
  status: StatusType;
}

const STATUS_CONFIG: Record<StatusType, { 
  bgColor: string; 
  borderColor: string; 
  textColor: string; 
  label: string; 
  glowColor?: string;
}> = {
  draft: {
    bgColor: 'rgba(148, 163, 184, 0.1)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
    textColor: '#94A3B8',
    label: 'Draft',
  },
  pending: {
    bgColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(252, 211, 77, 0.3)',
    textColor: '#FCD34D',
    label: 'Pending',
    glowColor: 'rgba(252, 211, 77, 0.4)',
  },
  approved: {
    bgColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    textColor: '#6EE7B7',
    label: 'Approved',
    glowColor: 'rgba(110, 231, 183, 0.4)',
  },
  rejected: {
    bgColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    textColor: '#FCA5A5',
    label: 'Rejected',
    glowColor: 'rgba(252, 165, 165, 0.4)',
  },
};

const baseStyles = StyleSheet.create({
  container: {
    borderRadius: clinicalTokens.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
  },
  text: {
    fontSize: 10,
    textTransform: 'uppercase',
    fontFamily: clinicalTokens.fonts.heading,
    fontWeight: '600' as const,
  },
});

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  
  const containerStyle = [
    baseStyles.container,
    {
      backgroundColor: config.bgColor,
      borderColor: config.borderColor,
    },
    config.glowColor && Platform.OS === 'ios' ? {
      shadowColor: config.glowColor,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
    } : {},
    config.glowColor && Platform.OS === 'android' ? {
      elevation: 4,
    } : {},
  ];

  return (
    <View style={containerStyle}>
      <Text style={[baseStyles.text, { color: config.textColor }]}>{config.label}</Text>
    </View>
  );
}
