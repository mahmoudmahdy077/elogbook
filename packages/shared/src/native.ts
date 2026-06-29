/**
 * React Native entry point for @elogbook/shared.
 *
 * Used by Metro (the React Native bundler) when it encounters
 * `import ... from '@elogbook/shared'`. Re-exports the .native.tsx
 * components and the platform-agnostic code.
 *
 * The web bundler uses ./browser.ts instead — see that file.
 */

export * from './index';
// Native variants of the cross-platform components.
export {
  Panel as NativePanel,
  type PanelProps as NativePanelProps,
  GlassPanel as NativeGlassPanel,
  type GlassPanelProps as NativeGlassPanelProps,
  StatusBadge as NativeStatusBadge,
  type StatusBadgeProps as NativeStatusBadgeProps,
  type StatusVariant as NativeStatusVariant,
  type BadgeSize as NativeBadgeSize,
  ProgressRing as NativeProgressRing,
  type ProgressRingProps as NativeProgressRingProps,
  ClinicalText as NativeClinicalText,
  type ClinicalTextProps as NativeClinicalTextProps,
  type ClinicalTextSize as NativeClinicalTextSize,
} from './components/native';
