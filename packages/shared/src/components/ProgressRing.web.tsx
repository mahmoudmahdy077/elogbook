'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { clinicalTokens } from '../constants/design-tokens';

export interface ProgressRingProps {
  value: number;
  max?: number;
  label?: string;
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export const ProgressRing = React.memo(function ProgressRing({
  value,
  max = 100,
  label,
  color = clinicalTokens.colors.primary.DEFAULT,
  size = 120,
  strokeWidth = 8,
}: ProgressRingProps) {
  const motionPct = useMotionValue(0);
  const displayRef = useRef<SVGTextElement>(null);
  const { radius, circumference, percentage, offset } = useMemo(() => {
    const r = (size - strokeWidth * 2) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.min(Math.max((value / max) * 100, 0), 100);
    const o = c * (1 - p / 100);
    return { radius: r, circumference: c, percentage: p, offset: o };
  }, [size, strokeWidth, value, max]);

  useEffect(() => {
    const controls = animate(motionPct, percentage, {
      type: 'spring',
      stiffness: 100,
      damping: 15,
    });
    return controls.stop;
  }, [percentage, motionPct]);

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
          stroke={clinicalTokens.colors.neutral.dark}
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
          transition={{ type: 'spring', stiffness: 100, damping: 15 }}
          style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}
        />
        <text
          ref={displayRef}
          x={size / 2}
          y={size / 2 + 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={clinicalTokens.colors.text.primary}
          fontSize={size * 0.22}
          fontFamily={clinicalTokens.fonts.heading}
          transform={`rotate(90, ${size / 2}, ${size / 2})`}
        >
          0%
        </text>
      </svg>
      {label && (
        <span
          className="text-xs text-neutral-light/50 text-center"
          style={{ fontFamily: clinicalTokens.fonts.body }}
        >
          {label}
        </span>
      )}
    </motion.div>
  );
});