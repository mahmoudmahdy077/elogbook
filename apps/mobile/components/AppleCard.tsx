/**
 * AppleCard — Apple Health–inspired card component.
 *
 * White rounded card with subtle shadow and light border.
 * Mirrors the web `GlassPanel` aesthetic for mobile.
 */
import React from 'react';
import {
  View,
  Text,
  ViewStyle,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { colors, radius, shadows, fonts, fontSizes, spacing } from '../theme/design-tokens';
import type { ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────

export interface AppleCardProps {
  /** Primary card content */
  children: ReactNode;
  /** Optional title rendered in the card header */
  title?: string;
  /** Optional subtitle rendered below the title */
  subtitle?: string;
  /** Optional right-aligned header element (e.g. badge, action) */
  headerRight?: ReactNode;
  /** Fires when the card is pressed (makes the card tappable) */
  onPress?: () => void;
  /** Extra styles applied to the outer card View */
  style?: ViewStyle;
  /** Card variant */
  variant?: 'default' | 'frosted' | 'accent';
  /** Accessibility label */
  accessibilityLabel?: string;
}

// ── Component ──────────────────────────────────────────────────

export function AppleCard({
  children,
  title,
  subtitle,
  headerRight,
  onPress,
  style,
  variant = 'default',
  accessibilityLabel,
}: AppleCardProps) {
  const cardStyle: ViewStyle[] = [
    styles.base,
    variant === 'frosted' ? styles.frosted : undefined,
    variant === 'accent' ? styles.accent : undefined,
    style,
  ].filter(Boolean) as ViewStyle[];

  const hasHeader = title || subtitle || headerRight;

  const cardContent = (
    <>
      {hasHeader && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {title && (
              <Text
                style={styles.title}
                accessibilityRole="header"
                numberOfLines={1}
              >
                {title}
              </Text>
            )}
            {subtitle && (
              <Text
                style={styles.subtitle}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            )}
          </View>
          {headerRight && (
            <View style={styles.headerRight}>{headerRight}</View>
          )}
        </View>
      )}

      {children}

      {hasHeader && <View style={styles.divider} />}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        {cardContent}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={cardStyle}
      accessibilityLabel={accessibilityLabel}
    >
      {cardContent}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius['2xl'],
    padding: spacing.md,
    ...shadows.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  frosted: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  accent: {
    borderColor: colors.borderGlow,
    ...shadows.glow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  headerRight: {
    flexShrink: 0,
  },
  title: {
    fontSize: fontSizes.body,
    fontWeight: '600',
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: fontSizes.footnote,
    fontFamily: fonts.body,
    color: colors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
});
