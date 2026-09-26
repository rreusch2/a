import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Muted, Title } from '../../components/ui';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { colors } from '../../theme';

export default function SignInScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!supabaseConfigured) return;
    setBusy(true);
    const action =
      mode === 'in'
        ? supabase.auth.signInWithPassword({ email: email.trim(), password })
        : supabase.auth.signUp({ email: email.trim(), password });
    const { error } = await action;
    setBusy(false);
    if (error) Alert.alert('Could not sign in', error.message);
    else if (mode === 'up') Alert.alert('Check your email', 'Confirm the address if your project requires it, then sign in.');
  }

  async function apple() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('Apple did not return a token.');
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) Alert.alert('Apple sign-in failed', error.message);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert('Apple sign-in failed', error instanceof Error ? error.message : 'Try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Text style={styles.mark}>Agents</Text>
        <Title>Build an agent.{'\n'}Let it work.</Title>
        <Muted>Design flows on your phone. They run in the cloud, even when the app is closed.</Muted>
      </View>
      {supabaseConfigured ? (
        <View style={styles.form}>
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry />
          <Button label={busy ? 'Please wait' : mode === 'in' ? 'Sign in' : 'Create account'} onPress={() => void submit()} disabled={busy || !email || password.length < 6} />
          <Button label={mode === 'in' ? 'Need an account?' : 'Have an account?'} tone="ghost" onPress={() => setMode(mode === 'in' ? 'up' : 'in')} />
          {Platform.OS === 'ios' ? <Button label="Continue with Apple" tone="ghost" icon="logo-apple" onPress={() => void apple()} /> : null}
        </View>
      ) : (
        <Muted>
          Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to apps/mobile/.env, then restart Expo.
        </Muted>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: 'space-between' },
  hero: { gap: 12, paddingTop: 32 },
  mark: { color: colors.accent, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  form: { gap: 14, paddingBottom: 12 },
});
