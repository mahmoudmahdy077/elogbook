// Re-exports the web variants of the cross-platform components. The
// .native.tsx variants are NOT imported here — they are only resolved
// by Metro via the `react-native` package.json#exports condition
// (see browser.ts / native.ts in the package root). This keeps the
// .native.tsx files (which depend on react-native, react-native-svg,
// @react-native-community/blur) out of the web build graph entirely.
//
// Schema, types, and constants are platform-agnostic and live in the
// root index.ts. Do NOT add RN-only imports here.

export type { PanelProps } from './Panel.web';
export type { GlassPanelProps } from './GlassPanel.web';
export type { StatusBadgeProps, StatusVariant, BadgeSize } from './StatusBadge.web';
export type { ProgressRingProps } from './ProgressRing.web';
export type { ClinicalTextProps, ClinicalTextSize } from './ClinicalText.web';