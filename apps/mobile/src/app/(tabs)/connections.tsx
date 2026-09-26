import { PROVIDER_LABEL, type ProviderId } from '@agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Loading, Muted, Title } from '../../components/ui';
import { api } from '../../lib/api';
import { colors } from '../../theme';

WebBrowser.maybeCompleteAuthSession();

const providers: { id: ProviderId; detail: string }[] = [
  { id: 'gmail', detail: 'Read mail, and send only if you allow writes.' },
  { id: 'gcal', detail: 'Read your calendar, and create events if you allow writes.' },
  { id: 'slack', detail: 'Listen for messages and post when you allow writes.' },
  { id: 'notion', detail: 'Query databases, and create pages if you allow writes.' },
  { id: 'excel', detail: 'Read a workbook, and append rows if you allow writes.' },
];

interface Connection {
  id: string;
  provider: ProviderId;
  accountLabel: string | null;
  accessMode: 'read' | 'read_write';
}

export default function ConnectionsScreen() {
  const queryClient = useQueryClient();
  const [accessMode, setAccessMode] = useState<'read' | 'read_write'>('read');
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<{ connections: Connection[] }>('/connections'),
  });

  const connect = useMutation({
    mutationFn: async (provider: ProviderId) => {
      const session = await api<{ connectUrl: string }>('/connections/session', {
        method: 'POST',
        body: { provider, accessMode },
      });
      await WebBrowser.openAuthSessionAsync(session.connectUrl, 'agents://connections');
      return api('/connections/sync', { method: 'POST', body: { provider, accessMode } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connections'] }),
    onError: (error: Error) => Alert.alert('Could not connect', error.message),
  });

  const updateMode = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'read' | 'read_write' }) =>
      api(`/connections/${id}`, { method: 'PATCH', body: { accessMode: mode } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['connections'] }),
  });

  if (connections.isLoading) return <Loading />;
  const rows = connections.data?.connections ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Title>Connections</Title>
        <Muted>Sign-in uses the system browser. Agents can read by default. Turn on writes only for accounts you trust them to change.</Muted>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <Card>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.name}>Allow writes on new connections</Text>
              <Muted>Leave this off to connect an account as read-only.</Muted>
            </View>
            <Switch
              value={accessMode === 'read_write'}
              onValueChange={(value) => setAccessMode(value ? 'read_write' : 'read')}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
        </Card>
        {providers.map((provider) => {
          const linked = rows.filter((row) => row.provider === provider.id);
          return (
            <Card key={provider.id}>
              <Text style={styles.name}>{PROVIDER_LABEL[provider.id]}</Text>
              <Muted>{provider.detail}</Muted>
              {linked.map((row) => (
                <View key={row.id} style={styles.linked}>
                  <View style={styles.flex}>
                    <Text style={styles.account}>{row.accountLabel || 'Connected account'}</Text>
                    <Muted>{row.accessMode === 'read_write' ? 'Can write' : 'Read only'}</Muted>
                  </View>
                  <Switch
                    value={row.accessMode === 'read_write'}
                    onValueChange={(value) => updateMode.mutate({ id: row.id, mode: value ? 'read_write' : 'read' })}
                    trackColor={{ true: colors.accent, false: colors.line }}
                  />
                  <Pressable onPress={() => remove.mutate(row.id)}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              ))}
              <Button label={linked.length ? 'Connect another' : 'Connect'} onPress={() => connect.mutate(provider.id)} disabled={connect.isPending} />
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 6 },
  list: { padding: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, gap: 4 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700' },
  linked: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  account: { color: colors.text, fontWeight: '600' },
  remove: { color: colors.danger, fontWeight: '700' },
});
