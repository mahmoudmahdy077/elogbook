import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Defs, Filter, FeGaussianBlur, Text as SvgText } from 'react-native-svg';

interface ProgressRingProps {
  percentage: number;
  specialty: string;
  color: string;
  glowColor: string;
  size?: number;
}

export default function ProgressRing({
  percentage,
  specialty,
  color,
  glowColor,
  size = 120,
}: ProgressRingProps) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(Math.max(percentage, 0), 100);
  const offset = circumference * (1 - clampedPct / 100);

  return (
    <View style={{ width: size, height: size + 32, alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <Filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <FeGaussianBlur stdDeviation="3" result="blur" />
          </Filter>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1E293B"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          fill="none"
        />
        <SvgText
          x={size / 2}
          y={size / 2 + 2}
          textAnchor="middle"
          alignmentBaseline="central"
          fill="white"
          fontSize={size * 0.18}
          fontFamily="Outfit"
          fontWeight="600"
        >
          {Math.round(clampedPct)}%
        </SvgText>
      </Svg>
      <Text
        style={{
          color: '#E2E8F0',
          fontSize: 12,
          marginTop: 4,
          fontFamily: 'Inter',
          textAlign: 'center',
        }}
        numberOfLines={1}
      >
        {specialty}
      </Text>
    </View>
  );
}
