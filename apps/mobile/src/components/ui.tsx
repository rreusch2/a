import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors } from '../theme';

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  tone = 'accent',
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'ghost' | 'danger';
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, tone === 'ghost' && styles.ghost, tone === 'danger' && styles.danger, disabled && styles.disabled]}
    >
      {icon ? <Ionicons name={icon} size={16} color={tone === 'accent' ? '#1A1408' : colors.text} /> : null}
      <Text style={[styles.buttonText, tone === 'accent' && styles.buttonTextDark]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
  help,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  help?: string;
  keyboardType?: TextInputProps['keyboardType'];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize="none"
        style={[styles.input, multiline && styles.multiline]}
      />
      {help ? <Text style={styles.help}>{help}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <View style={[styles.pill, { borderColor: color ?? colors.line }]}>
      <Text style={[styles.pillText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Muted>{body}</Muted>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  ghost: { backgroundColor: colors.surface2 },
  danger: { backgroundColor: '#3A2224' },
  disabled: { opacity: 0.5 },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 16 },
  buttonTextDark: { color: '#1A1408' },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 8,
  },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  empty: { paddingVertical: 48, gap: 8, alignItems: 'flex-start' },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
