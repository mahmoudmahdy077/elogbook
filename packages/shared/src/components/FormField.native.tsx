import { View, Text, TextInput, type TextInputProps, type ViewStyle } from 'react-native';
import { clinicalTokens } from '../constants/design-tokens';
import type { ReactNode } from 'react';

export interface FormFieldProps extends Omit<TextInputProps, 'onChange' | 'value'> {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  rightElement?: ReactNode;
  inputStyle?: ViewStyle;
}

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  secureTextEntry,
  rightElement,
  inputStyle,
  ...props
}: FormFieldProps) {
  return (
    <View>
      <Text style={{ color: clinicalTokens.colors.text.primary, fontSize: 14, fontWeight: '500', marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ position: 'relative' }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={clinicalTokens.colors.text.muted + '80'}
          secureTextEntry={secureTextEntry}
          style={{
            width: '100%',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: clinicalTokens.colors.neutral.dark,
            borderWidth: 1,
            borderColor: clinicalTokens.colors.border.DEFAULT,
            color: clinicalTokens.colors.text.primary,
            fontSize: 14,
            ...inputStyle,
          }}
          {...props}
        />
        {rightElement && (
          <View style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}>
            {rightElement}
          </View>
        )}
      </View>
    </View>
  );
}
