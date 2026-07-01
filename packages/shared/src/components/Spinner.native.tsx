import { ActivityIndicator } from 'react-native';
import { clinicalTokens } from '../constants/design-tokens';

export interface SpinnerProps {
  size?: number;
}

export function Spinner({ size = 16 }: SpinnerProps) {
  return <ActivityIndicator size={size} color={clinicalTokens.colors.text.primary} />;
}
