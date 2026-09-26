import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, Loading, Muted, Pill, Title } from '../../components/ui';
import { api, timeAgo } from '../../lib/api';
import { colors } from '../../theme';

interface RunItem {
  id: string;
  agentId: string;
  status: string;
  triggerType: string;
  dryRun: boolean;
  createdAt: string;
  error: string | null;
}

interface ApprovalItem {
  id: string;
  runId: string;
  summary: string;
  status: string;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  succeeded: colors.ok,
  failed: colors.danger,
  waiting_approval: colors.accent,
  running: colors.blue,
  cancelled: colors.muted,
};

export default function ActivityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api<{ runs: RunItem[] }>('/runs') });
  const approvals = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api<{ approvals: ApprovalItem[] }>('/approvals?status=pending'),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      api(`/approvals/${id}/decide`, { method: 'POST', body: { decision } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (error: Error) => Alert.alert('Could not save that decision', error.message),
  });

  if (runs.isLoading || approvals.isLoading) return <Loading />;
  const pending = approvals.data?.approvals ?? [];
  const items = runs.data?.runs ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Title>Activity</Title>
        <Muted>Approvals pause a run until you say yes. Everything else is a log of what already happened.</Muted>
      </View>
      <ScrollView contentContainerStyle={styles.list} refreshControl={undefined}>
        <Text style={styles.section}>Waiting on you</Text>
        {pending.length === 0 ? <Muted>Nothing to approve.</Muted> : null}
        {pending.map((approval) => (
          <Card key={approval.id}>
            <Text style={styles.summary}>{approval.summary}</Text>
            <Muted>{timeAgo(approval.createdAt)}</Muted>
            <View style={styles.row}>
              <Button label="Reject" tone="danger" onPress={() => decide.mutate({ id: approval.id, decision: 'rejected' })} />
              <Button label="Approve" onPress={() => decide.mutate({ id: approval.id, decision: 'approved' })} />
            </View>
          </Card>
        ))}
        <Text style={styles.section}>Runs</Text>
        {items.length === 0 ? <Empty title="No runs yet" body="Test an agent from its builder. The steps will show up here." /> : null}
        {items.map((run) => (
          <Pressable key={run.id} onPress={() => router.push(`/runs/${run.id}`)}>
            <Card>
              <View style={styles.row}>
                <Text style={styles.summary}>{run.triggerType}{run.dryRun ? ' · test' : ''}</Text>
                <Pill label={run.status} color={statusColor[run.status] ?? colors.muted} />
              </View>
              <Muted>{timeAgo(run.createdAt)}</Muted>
              {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
            </Card>
          </Pressable>
        ))}
        <Button label="Refresh" tone="ghost" onPress={() => { void runs.refetch(); void approvals.refetch(); }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 6 },
  list: { padding: 20, gap: 12 },
  section: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  summary: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  error: { color: colors.danger },
});
