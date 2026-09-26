import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Field, Loading, Muted, Title } from '../../components/ui';
import { api } from '../../lib/api';
import { registerForPush } from '../../lib/push';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';

interface Me {
  email: string | null;
  displayName: string;
  llmKeys: { anthropic: boolean; openai: boolean };
}

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
  const [name, setName] = useState<string | null>(null);
  const [anthropic, setAnthropic] = useState('');
  const [openai, setOpenai] = useState('');

  const saveName = useMutation({
    mutationFn: () => api('/me', { method: 'PATCH', body: { displayName: name ?? me.data?.displayName ?? '' } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
  const saveKey = useMutation({
    mutationFn: (body: { provider: 'anthropic' | 'openai'; apiKey: string }) => api('/me/llm-keys', { method: 'PUT', body }),
    onSuccess: () => {
      setAnthropic('');
      setOpenai('');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error: Error) => Alert.alert('Could not save the key', error.message),
  });

  if (me.isLoading) return <Loading />;
  if (!me.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <Muted>{me.error instanceof Error ? me.error.message : 'Could not load settings.'}</Muted>
      </SafeAreaView>
    );
  }
  const profile = me.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Title>Settings</Title>
        <Muted>{profile.email}</Muted>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <Card>
          <Field label="Display name" value={name ?? profile.displayName} onChangeText={setName} />
          <Button label="Save name" tone="ghost" onPress={() => saveName.mutate()} />
        </Card>
        <Card>
          <Text style={styles.heading}>Model keys</Text>
          <Muted>
            Optional. If you leave these blank, agents use the keys on the server. Yours are encrypted before they are stored.
            Claude is {profile.llmKeys.anthropic ? 'saved' : 'using the server key'}. OpenAI is{' '}
            {profile.llmKeys.openai ? 'saved' : 'using the server key'}.
          </Muted>
          <Field label="Claude API key" value={anthropic} onChangeText={setAnthropic} placeholder="sk-ant-..." secureTextEntry />
          <Button label="Save Claude key" tone="ghost" onPress={() => saveKey.mutate({ provider: 'anthropic', apiKey: anthropic })} disabled={anthropic.length < 10} />
          <Field label="OpenAI API key" value={openai} onChangeText={setOpenai} placeholder="sk-..." secureTextEntry />
          <Button label="Save OpenAI key" tone="ghost" onPress={() => saveKey.mutate({ provider: 'openai', apiKey: openai })} disabled={openai.length < 10} />
        </Card>
        <Card>
          <Text style={styles.heading}>Notifications</Text>
          <Muted>Approvals and failed runs can ping this phone.</Muted>
          <Button
            label="Enable notifications"
            onPress={() =>
              void registerForPush()
                .then((token) => Alert.alert(token ? 'Notifications are on' : 'Notifications stayed off'))
                .catch((error: Error) => Alert.alert('Notifications', error.message))
            }
          />
        </Card>
        <Card>
          <Text style={styles.heading}>How a run works</Text>
          <Muted>
            The phone saves the flow. The server is what watches for new mail, waits on a schedule, calls the model, and talks to Gmail, Slack, Notion, Calendar, and Excel. Pausing an agent stops it and cancels anything still in progress.
          </Muted>
        </Card>
        <Button label="Sign out" tone="danger" onPress={() => void supabase.auth.signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 6 },
  list: { padding: 20, gap: 12 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
