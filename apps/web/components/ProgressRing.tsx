'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface ProgressRingProps {
  percentage: number;
  label: string;
  color: string;
  glowColor: string;
  size?: number;
}

export default function ProgressRing({
  percentage,
  label,
  color,
  glowColor,
  size = 100,
}: ProgressRingProps) {
  const [animatedPct, setAnimatedPct] = useState(0);
  const strokeWidth = 6;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(Math.max(percentage, 0), 100);
  const offset = circumference * (1 - clampedPct / 100);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPct(clampedPct), 100);
    return () => clearTimeout(timer);
  }, [clampedPct]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-2"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-neutral-dark)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
        <text
          x={size / 2}
          y={size / 2 + 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-text-primary)"
          fontSize={size * 0.22}
          fontFamily="var(--font-heading)"
          transform={`rotate(90, ${size / 2}, ${size / 2})`}
        >
          {Math.round(animatedPct)}%
        </text>
      </svg>
      <span className="text-xs text-neutral-light/50 text-center">{label}</span>
    </motion.div>
  );
}
