'use client';

import { useEffect, useRef } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';

interface ProgressRingProps {
  percentage: number;
  label: string;
  size?: number;
}

export default function ProgressRing({
  percentage,
  label,
  size = 100,
}: ProgressRingProps) {
  const motionPct = useMotionValue(0);
  const displayRef = useRef<SVGTextElement>(null);
  const strokeWidth = 6;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.min(Math.max(percentage, 0), 100);
  const offset = circumference * (1 - clampedPct / 100);

  useEffect(() => {
    const controls = animate(motionPct, clampedPct, {
      type: 'spring',
      stiffness: 100,
      damping: 15,
    });
    return controls.stop;
  }, [clampedPct, motionPct]);

  useEffect(() => {
    const unsubscribe = motionPct.on('change', (v) => {
      if (displayRef.current) {
        displayRef.current.textContent = `${Math.round(v)}%`;
      }
    });
    return unsubscribe;
  }, [motionPct]);

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
          stroke="var(--color-primary)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 100, damping: 15 }}
          style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
        />
        <text
          ref={displayRef}
          x={size / 2}
          y={size / 2 + 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--color-text-primary)"
          fontSize={size * 0.22}
          fontFamily="var(--font-heading)"
          transform={`rotate(90, ${size / 2}, ${size / 2})`}
        >
          0%
        </text>
      </svg>
      <span className="text-xs text-neutral-light/50 text-center">{label}</span>
    </motion.div>
  );
}
