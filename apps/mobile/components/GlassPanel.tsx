import React from 'react';
import { View, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';

interface GlassPanelProps {
  blurIntensity?: number;
  children: React.ReactNode;
  style?: object;
}

export default function GlassPanel({ blurIntensity = 12, children, style }: GlassPanelProps) {
  return (
    <View style={[styles.container, style]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType="dark"
        blurAmount={blurIntensity}
        reducedTransparencyFallbackColor="#0F172A"
      />
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: 16,
  },
  content: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
  },
});
