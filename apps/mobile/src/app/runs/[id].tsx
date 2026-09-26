import { getNodeDefinition } from '@agents/shared';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Loading, Muted, Pill } from '../../components/ui';
import { api, timeAgo } from '../../lib/api';
import { colors } from '../../theme';

interface Step {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
}

interface RunDetail {
  run: {
    id: string;
    status: string;
    triggerType: string;
    dryRun: boolean;
    error: string | null;
    tokenUsage: { input?: number; output?: number } | null;
    createdAt: string;
  };
  steps: Step[];
}

const statusColor: Record<string, string> = {
  succeeded: colors.ok,
  failed: colors.danger,
  waiting: colors.accent,
  waiting_approval: colors.accent,
  running: colors.blue,
};

export default function RunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['run', id],
    queryFn: () => api<RunDetail>(`/runs/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status && ['succeeded', 'failed', 'cancelled'].includes(status) ? false : 1500;
    },
  });

  if (detail.isLoading || !detail.data) return <Loading />;
  const { run, steps } = detail.data;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>{run.dryRun ? 'Test run' : 'Run'}</Text>
          <Muted>{run.triggerType} · {timeAgo(run.createdAt)}</Muted>
        </View>
        <Pill label={run.status} color={statusColor[run.status] ?? colors.muted} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
        {run.tokenUsage ? (
          <Muted>
            Tokens in {run.tokenUsage.input ?? 0} · out {run.tokenUsage.output ?? 0}
          </Muted>
        ) : null}
        {steps.map((step, index) => {
          const def = getNodeDefinition(step.nodeType);
          const expanded = open === step.id;
          return (
            <Pressable key={step.id} onPress={() => setOpen(expanded ? null : step.id)} style={styles.step}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: statusColor[step.status] ?? colors.muted }]} />
                {index < steps.length - 1 ? <View style={styles.line} /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.stepTitle}>{def?.label ?? step.nodeType}</Text>
                <Muted>{step.nodeId}</Muted>
                {step.error ? <Text style={styles.error}>{step.error}</Text> : null}
                {expanded ? (
                  <Text style={styles.json}>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        {steps.length === 0 ? <Muted>Waiting for the first step.</Muted> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  flex: { flex: 1 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  list: { padding: 16, gap: 8 },
  step: { flexDirection: 'row', gap: 12 },
  rail: { width: 16, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  line: { width: 2, flex: 1, backgroundColor: colors.line, marginTop: 4 },
  stepTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  error: { color: colors.danger },
  json: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 8 },
});
