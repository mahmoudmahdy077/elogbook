import { Text, type TextProps } from 'react-native';

// Use these instead of plain <Text> for any user-facing copy that should:
//  - Honor the user's preferred font size (Dynamic Type / OS font scaling).
//  - Expose a screen-reader label even when the visible text is short / icon-only.
//
// Props mirror React Native's Text props with two additions:
//   - accessibilityLabel: override (defaults to `children` if a string).
//   - accessibilityRole: optional role hint.
export type AccessibleTextProps = TextProps & {
  accessibilityLabel?: string;
  accessibilityRole?: 'text' | 'header' | 'link' | 'summary';
  maxFontSizeMultiplier?: number;
  allowFontScaling?: boolean;
};

export function AccessibleText({
  children,
  accessibilityLabel,
  accessibilityRole = 'text',
  maxFontSizeMultiplier = 1.6,
  allowFontScaling = true,
  ...rest
}: AccessibleTextProps) {
  const label =
    accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  return (
    <Text
      {...rest}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      accessibilityLabel={label}
      accessibilityRole={accessibilityRole}
    >
      {children}
    </Text>
  );
}
