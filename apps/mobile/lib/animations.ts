/**
 * Animation utilities for Elogbook mobile app.
 * Uses react-native-reanimated for native-thread animations.
 */
import { useCallback } from 'react';
import { TouchableOpacity } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutRight,
  SlideInUp,
  ZoomIn,
  Layout,
  type AnimatableValue,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';

// ── Spring presets ──────────────────────────────────────────────────────

export const springConfig = {
  /** Gentle bounce for card entries */
  gentle: { damping: 18, stiffness: 150, mass: 0.8 } as WithSpringConfig,
  /** Snappy press feedback */
  snap: { damping: 12, stiffness: 250, mass: 0.5 } as WithSpringConfig,
  /** Smooth transition */
  smooth: { damping: 20, stiffness: 100, mass: 1 } as WithSpringConfig,
};

export const timingConfig = {
  fadeIn: { duration: 300 } as WithTimingConfig,
  fadeOut: { duration: 200 } as WithTimingConfig,
};

// ── Animated entering/exiting presets ───────────────────────────────────

export const Entering = {
  fadeIn: FadeIn.duration(300),
  fadeInSlow: FadeIn.duration(500),
  slideUp: SlideInUp.springify().damping(18).stiffness(150),
  slideRight: SlideInRight.springify().damping(20).stiffness(120),
  zoomIn: ZoomIn.springify().damping(15).stiffness(200),
  /** Staggered fade-in for lists */
  staggeredFadeIn: (index: number) =>
    FadeIn.duration(300).delay(index * 60),
  staggeredSlideUp: (index: number) =>
    SlideInUp.springify()
      .damping(20)
      .stiffness(150)
      .delay(index * 60),
};

export const Exiting = {
  fadeOut: FadeOut.duration(200),
  slideRight: SlideOutRight.duration(200),
};

// ── Layout animation for reordering lists ──────────────────────────────

export const listLayout = Layout.springify().damping(20).stiffness(150);

// ── Press-scale hook ────────────────────────────────────────────────────

export function usePressScale(scaleTo = 0.96) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = useCallback(() => {
    scale.value = withSpring(scaleTo, springConfig.snap);
  }, [scale, scaleTo]);

  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, springConfig.snap);
  }, [scale]);

  return { animatedStyle, onPressIn, onPressOut };
}

// ── AnimatedPressable ────────────────────────────────────────────────────

export function AnimatedPressable({
  onPress,
  children,
  scaleTo = 0.96,
  style,
  ...rest
}: {
  onPress?: () => void;
  children: React.ReactNode;
  scaleTo?: number;
  style?: any;
}) {
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(scaleTo);

  return (
    <Animated.View style={[animatedStyle, style]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        activeOpacity={1}
        {...rest}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Shimmer/Skeleton loading ────────────────────────────────────────────

export function ShimmerBlock({
  width = '100%',
  height = 20,
  borderRadius = 8,
  style,
}: {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
}) {
  const opacity = useSharedValue(0.3);

  // Animate opacity for shimmer effect
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(opacity.value > 0.5 ? 0.3 : 0.6, { duration: 800 }),
  }));

  // Toggle opacity
  opacity.value = opacity.value > 0.5 ? 0.3 : 0.6;

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: '#E5E5EA',
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export default {
  springConfig,
  timingConfig,
  Entering,
  Exiting,
  listLayout,
  usePressScale,
  AnimatedPressable,
  ShimmerBlock,
};
