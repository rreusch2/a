import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, Loading, Muted, Pill, Title } from '../../components/ui';
import { api, timeAgo } from '../../lib/api';
import { localStore } from '../../lib/supabase';
import { colors } from '../../theme';

interface AgentCard {
  id: string;
  name: string;
  color: string;
  status: 'draft' | 'active' | 'paused';
  lastRunAt: string | null;
  lastStatus: string | null;
  successRate: number | null;
}

const slides = [
  { title: 'Start from a template', body: 'Most people never open a blank canvas. Clone a template, then change the bits that are yours.' },
  { title: 'Connect only what you trust', body: 'Each account can stay read-only until you explicitly allow an agent to write.' },
  { title: 'Test before it goes live', body: 'A test run uses your draft and skips sending, posting, and other writes. Turn an agent on only after that looks right.' },
];

export default function AgentsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [onboarding, setOnboarding] = useState(false);
  const [slide, setSlide] = useState(0);
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<{ agents: AgentCard[] }>('/agents'),
  });

  useEffect(() => {
    void localStore.getItem('agents.onboarded').then((value) => {
      if (!value) setOnboarding(true);
    });
  }, []);

  const create = useMutation({
    mutationFn: () => api<{ agent: { id: string } }>('/agents', { method: 'POST', body: { name: 'New agent' } }),
    onSuccess: ({ agent }) => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      router.push(`/agents/${agent.id}/builder`);
    },
    onError: (error: Error) => Alert.alert('Could not create an agent', error.message),
  });

  async function finishOnboarding() {
    await localStore.setItem('agents.onboarded', '1');
    setOnboarding(false);
  }

  if (agents.isLoading) return <Loading />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Your agents</Text>
          <Title>Agents</Title>
        </View>
        <Button label="New" icon="add" onPress={() => create.mutate()} disabled={create.isPending} />
      </View>
      <FlatList
        data={agents.data?.agents ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={agents.isRefetching}
        onRefresh={() => void agents.refetch()}
        ListEmptyComponent={
          <Empty title="No agents yet" body="Create one from scratch, or open Templates and clone a starting point." />
        }
        renderItem={({ item }) => (
          <Card>
            <Pressable onPress={() => router.push(`/agents/${item.id}/builder`)} style={styles.cardPress}>
              <View style={[styles.swatch, { backgroundColor: item.color }]} />
              <View style={styles.flex}>
                <View style={styles.row}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Pill
                    label={item.status}
                    color={item.status === 'active' ? colors.ok : item.status === 'paused' ? colors.accent : colors.muted}
                  />
                </View>
                <Muted>
                  {timeAgo(item.lastRunAt)}
                  {item.successRate == null ? '' : ` · ${Math.round(item.successRate * 100)}% succeeded`}
                </Muted>
              </View>
            </Pressable>
            <View style={styles.actions}>
              <Button label="Open" tone="ghost" onPress={() => router.push(`/agents/${item.id}/builder`)} />
              <Button
                label={item.status === 'active' ? 'Run' : 'Test'}
                onPress={() =>
                  void api(`/agents/${item.id}/runs`, { method: 'POST', body: { dryRun: item.status !== 'active' } })
                    .then((body) => router.push(`/runs/${(body as { runId: string }).runId}`))
                    .catch((error: Error) => Alert.alert('Could not start', error.message))
                }
              />
            </View>
          </Card>
        )}
      />
      <Modal visible={onboarding} animationType="slide" transparent>
        <View style={styles.modal}>
          <View style={styles.sheet}>
            <Text style={styles.kicker}>Welcome</Text>
            <Text style={styles.modalTitle}>{slides[slide]?.title}</Text>
            <Muted>{slides[slide]?.body}</Muted>
            <Button
              label={slide === slides.length - 1 ? 'Start building' : 'Next'}
              onPress={() => {
                if (slide === slides.length - 1) void finishOnboarding();
                else setSlide(slide + 1);
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  kicker: { color: colors.accent, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', fontSize: 12 },
  list: { padding: 20, gap: 12 },
  cardPress: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  swatch: { width: 14, height: 42, borderRadius: 7 },
  flex: { flex: 1, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: colors.surface, padding: 24, gap: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalTitle: { color: colors.text, fontSize: 28, fontWeight: '700' },
});
