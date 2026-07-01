// Web variants of the cross-platform components. This file is the
// entry that the web bundler (Turbopack/webpack) loads via the
// `browser` package.json#exports condition.
//
// The .native.tsx variants live in a separate file and are NEVER
// imported here — see ./native.ts. That separation is what keeps
// react-native, react-native-svg, and @react-native-community/blur
// out of the web build graph entirely.

export {
  Panel,
  type PanelProps,
} from './Panel.web';

export {
  GlassPanel,
  type GlassPanelProps,
} from './GlassPanel.web';

export {
  StatusBadge,
  type StatusBadgeProps,
  type StatusVariant,
  type BadgeSize,
} from './StatusBadge.web';

export {
  ProgressRing,
  type ProgressRingProps,
} from './ProgressRing.web';

export {
  ClinicalText,
  type ClinicalTextProps,
  type ClinicalTextSize,
} from './ClinicalText.web';

export {
  FormField,
  type FormFieldProps,
} from './FormField.web';

export {
  FormDivider,
  type FormDividerProps,
} from './FormDivider.web';

export {
  Spinner,
  type SpinnerProps,
} from './Spinner.web';
