import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { clinicalTokens } from '@elogbook/shared';

export interface ScreenErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional callback so the host can report to Sentry / Crashlytics. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Label rendered to the user when the boundary trips. */
  screenName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ScreenErrorBoundary extends React.Component<ScreenErrorBoundaryProps, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      this.props.onError?.(error, info);
    } catch {
      // never let the boundary itself throw
    }
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    const label = this.props.screenName ?? 'this screen';
    return (
      <View
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: clinicalTokens.colors.backdrop.dark }}
        accessibilityLiveRegion="assertive"
        accessible
      >
        <Text
          className="text-white text-xl mb-2 text-center"
          style={{ fontFamily: clinicalTokens.fonts.heading }}
          accessibilityRole="header"
        >
          {label} could not be displayed
        </Text>
        <Text
          className="text-slate-400 text-sm mb-6 text-center"
          style={{ fontFamily: clinicalTokens.fonts.body }}
        >
          {this.state.error?.message ?? 'An unexpected error occurred.'}
        </Text>
        <TouchableOpacity
          className="bg-teal-600 rounded-xl py-3 px-6"
          onPress={this.reset}
          accessibilityLabel={`Retry ${label}`}
          accessibilityRole="button"
        >
          <Text
            className="text-white text-base"
            style={{ fontFamily: clinicalTokens.fonts.heading }}
          >
            Try again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}
