/**
 * Browser entry point for @elogbook/shared.
 *
 * This file is what the web bundler (webpack/Turbopack) loads when
 * it encounters `import ... from '@elogbook/shared'`. It re-exports
 * the .web.tsx components and types — but NEVER the .native.tsx ones
 * (which depend on react-native / react-native-svg / blur and would
 * explode the web bundle with React Native code that cannot be parsed
 * by a web bundler).
 *
 * The React Native bundler (Metro) uses ./native.ts instead, which is
 * the inverse: web-only deps are not pulled in.
 *
 * Schema, types, constants, and tokens are platform-agnostic and live
 * in index.ts; those are re-exported from BOTH entry points.
 */

export * from './index';
// Only the web variants of the components are safe to import here.
// The barrel in ./components/index.ts also re-exports the .native
// variants, but the .web bundler will see the browser entry first
// and will only see these named web exports.
export {
  Panel,
  type PanelProps,
  GlassPanel,
  type GlassPanelProps,
  StatusBadge,
  type StatusBadgeProps,
  type StatusVariant,
  type BadgeSize,
  ProgressRing,
  type ProgressRingProps,
  ClinicalText,
  type ClinicalTextProps,
  type ClinicalTextSize,
} from './components/web';
