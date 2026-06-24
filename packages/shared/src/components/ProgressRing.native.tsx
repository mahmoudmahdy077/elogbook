import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ViewStyle, TextStyle } from 'react-native';
import * as Svg from 'react-native-svg';
import { clinicalTokens } from '../constants/design-tokens';

// Use type assertions to avoid React Native type conflicts in shared package
const SvgSvg = Svg.Svg as any;
const SvgDefs = Svg.Defs as any;
const SvgFilter = Svg.Filter as any;
const SvgFeGaussianBlur = Svg.FeGaussianBlur as any;
const SvgCircle = Svg.Circle as any;
const SvgText = Svg.Text as any;

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
  const [animatedOffset, setAnimatedOffset] = useState(
    (size - strokeWidth) * Math.PI
  );

  useEffect(() => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
    const targetOffset = circumference * (1 - percentage / 100);

    const start = animatedOffset;
    const duration = 800;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (targetOffset - start) * eased;
      setAnimatedOffset(current);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, max, size, strokeWidth]);

  const { radius, circumference, percentage } = useMemo(() => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.min(Math.max((value / max) * 100, 0), 100);
    return { radius: r, circumference: c, percentage: p };
  }, [size, strokeWidth, value, max]);

  const containerStyle: ViewStyle = {
    width: size,
    height: size + (label ? 32 : 0),
    alignItems: 'center',
  };

  const textStyle: TextStyle = {
    color: clinicalTokens.colors.text.secondary,
    fontSize: 12,
    marginTop: 4,
    fontFamily: clinicalTokens.fonts.body,
    textAlign: 'center',
  };

  return React.createElement(
    View,
    { style: containerStyle },
    React.createElement(
      SvgSvg,
      { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      React.createElement(
        SvgDefs,
        null,
        React.createElement(
          SvgFilter,
          { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
          React.createElement(SvgFeGaussianBlur, { stdDeviation: 3, result: 'blur' })
        )
      ),
      React.createElement(SvgCircle, {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        stroke: clinicalTokens.colors.neutral.dark,
        strokeWidth,
        fill: 'none',
      }),
      React.createElement(SvgCircle, {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        stroke: color,
        strokeWidth,
        strokeLinecap: 'round',
        strokeDasharray: circumference,
        strokeDashoffset: animatedOffset,
        fill: 'none',
        filter: 'url(#glow)',
      }),
      React.createElement(SvgText, {
        x: size / 2,
        y: size / 2 + 2,
        textAnchor: 'middle',
        alignmentBaseline: 'central',
        fill: clinicalTokens.colors.text.primary,
        fontSize: size * 0.22,
        fontFamily: clinicalTokens.fonts.heading,
        fontWeight: '600',
      }, `${Math.round(percentage)}%`)
    ),
    label && React.createElement(Text, { style: textStyle, numberOfLines: 1 }, label)
  );
});