// Cross-platform components — re-export only the .web/.native variants
// under platform-namespaced subpaths. Bundlers select the right one
// based on the importer's platform.
//
// Web importers: `import { Panel } from '@elogbook/shared/components/web'`
// RN importers:   `import { NativePanel } from '@elogbook/shared/components/native'`
//
// Top-level barrel re-exports the web variants for the platform
// (see ./browser.ts).

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
} from './Panel.web';
export {
  StatusBadge as LegacyStatusBadge,
} from './StatusBadge.web';
