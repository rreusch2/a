import {
  CATEGORY_LABEL,
  getNodeDefinition,
  listNodeDefinitions,
  type Graph,
  type NodeCategory,
} from '@agents/shared';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConfigForm } from '../../../components/ConfigForm';
import { NodeCanvas } from '../../../components/canvas/NodeCanvas';
import { Sheet } from '../../../components/Sheet';
import { Button, Loading } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useBuilder } from '../../../state/builder';
import { colors } from '../../../theme';

interface AgentDetail {
  agent: {
    id: string;
    name: string;
    status: 'draft' | 'active' | 'paused';
    draftGraph: Graph;
    activeVersionId: string | null;
  };
  triggers: { id: string; type: string; webhookUrl: string | null; webhookSecret: string | null; enabled: boolean }[];
}

const categories: NodeCategory[] = ['trigger', 'ai', 'action', 'logic'];

export default function BuilderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api<AgentDetail>(`/agents/${id}`),
  });
  const graph = useBuilder((state) => state.graph);
  const dirty = useBuilder((state) => state.dirty);
  const load = useBuilder((state) => state.load);
  const markSaved = useBuilder((state) => state.markSaved);
  const markDirty = useBuilder((state) => state.markDirty);
  const selectedId = useBuilder((state) => state.selectedId);
  const select = useBuilder((state) => state.select);
  const addNode = useBuilder((state) => state.addNode);
  const undo = useBuilder((state) => state.undo);
  const redo = useBuilder((state) => state.redo);
  const [library, setLibrary] = useState(false);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [doneNodeIds, setDoneNodeIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    setReady(false);
  }, [id]);

  useEffect(() => {
    if (!detail.data || !id || loadedFor.current === id) return;
    loadedFor.current = id;
    load(detail.data.agent.draftGraph ?? { nodes: [], edges: [] });
    setName(detail.data.agent.name);
    setReady(true);
  }, [detail.data, id, load]);

  useEffect(() => {
    if (!dirty || !id || !ready) return;
    const timer = setTimeout(() => {
      void api(`/agents/${id}`, { method: 'PATCH', body: { draftGraph: graph, name } })
        .then(() => markSaved())
        .catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [dirty, graph, id, markSaved, name, ready]);

  const nodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listNodeDefinitions().filter((node) => !q || `${node.label} ${node.description}`.toLowerCase().includes(q));
  }, [query]);

  const publish = useMutation({
    mutationFn: () => api(`/agents/${id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent', id] });
      Alert.alert('Published', 'This version is saved. Turn the agent on when you want it to run on its own.', [
        { text: 'Not yet' },
        {
          text: 'Turn on',
          onPress: () =>
            void api(`/agents/${id}/activate`, { method: 'POST' }).then(() =>
              queryClient.invalidateQueries({ queryKey: ['agent', id] }),
            ),
        },
      ]);
    },
    onError: (error: Error) => Alert.alert('Cannot publish yet', error.message),
  });

  async function testRun() {
    try {
      if (dirty) await api(`/agents/${id}`, { method: 'PATCH', body: { draftGraph: graph, name } });
      const { runId } = await api<{ runId: string }>(`/agents/${id}/runs`, { method: 'POST', body: { dryRun: true } });
      setDoneNodeIds([]);
      const poll = async () => {
        const body = await api<{ run: { status: string }; steps: { nodeId: string; status: string }[] }>(`/runs/${runId}`);
        const steps = body.steps ?? [];
        setDoneNodeIds(steps.filter((step) => step.status === 'succeeded').map((step) => step.nodeId));
        const waiting = steps.find((step) => step.status === 'waiting');
        setActiveNodeId(waiting?.nodeId ?? steps.at(-1)?.nodeId ?? null);
        if (['succeeded', 'failed', 'cancelled', 'waiting_approval'].includes(body.run.status)) {
          router.push(`/runs/${runId}`);
          return;
        }
        setTimeout(() => void poll(), 1000);
      };
      void poll();
    } catch (error) {
      Alert.alert('Test failed to start', error instanceof Error ? error.message : 'Try again.');
    }
  }

  async function togglePower() {
    const status = detail.data?.agent.status;
    const path = status === 'active' ? 'pause' : 'activate';
    try {
      await api(`/agents/${id}/${path}`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['agent', id] });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    } catch (error) {
      Alert.alert(status === 'active' ? 'Could not stop' : 'Could not turn on', error instanceof Error ? error.message : 'Try again.');
    }
  }

  if (detail.isLoading || !detail.data || !ready) {
    return detail.isError ? (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.webhook}>{detail.error instanceof Error ? detail.error.message : 'Could not open this agent.'}</Text>
      </SafeAreaView>
    ) : (
      <Loading />
    );
  }
  const webhook = detail.data.triggers.find((trigger) => trigger.webhookUrl);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.toolbar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <TextInput
          value={name}
          onChangeText={(value) => {
            setName(value);
            markDirty();
          }}
          style={styles.name}
          placeholder="Agent name"
          placeholderTextColor={colors.muted}
        />
        <Pressable onPress={undo} hitSlop={8}>
          <Ionicons name="arrow-undo" size={20} color={colors.text} />
        </Pressable>
        <Pressable onPress={redo} hitSlop={8}>
          <Ionicons name="arrow-redo" size={20} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Button label="Test" tone="ghost" onPress={() => void testRun()} />
        <Button label="Publish" onPress={() => publish.mutate()} disabled={publish.isPending} />
        <Button
          label={detail.data.agent.status === 'active' ? 'Stop' : 'Turn on'}
          tone={detail.data.agent.status === 'active' ? 'danger' : 'ghost'}
          onPress={() => void togglePower()}
        />
      </View>
      {webhook?.webhookUrl ? (
        <Text style={styles.webhook} numberOfLines={2}>
          Webhook: {webhook.webhookUrl}
          {webhook.webhookSecret ? `  ·  secret ${webhook.webhookSecret}` : ''}
        </Text>
      ) : null}
      <NodeCanvas activeNodeId={activeNodeId} doneNodeIds={doneNodeIds} />
      <Pressable style={styles.add} onPress={() => { select(null); setLibrary(true); }}>
        <Ionicons name="add" size={28} color="#1A1408" />
      </Pressable>
      <Sheet
        open={library || Boolean(selectedId)}
        onClose={() => {
          setLibrary(false);
          select(null);
        }}
      >
        {selectedId && !library ? (
          <ConfigForm nodeId={selectedId} />
        ) : (
          <View style={styles.library}>
            <Text style={styles.libraryTitle}>Add a step</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search steps"
              placeholderTextColor={colors.muted}
              style={styles.search}
            />
            {categories.map((category) => {
              const group = nodes.filter((node) => node.category === category);
              if (!group.length) return null;
              return (
                <View key={category} style={styles.group}>
                  <Text style={styles.groupLabel}>{CATEGORY_LABEL[category]}</Text>
                  {group.map((node) => (
                    <Pressable
                      key={node.type}
                      style={styles.libRow}
                      onPress={() => {
                        const nodeId = `n${Math.random().toString(36).slice(2, 8)}`;
                        addNode({
                          id: nodeId,
                          type: node.type,
                          position: { x: 80 + graph.nodes.length * 16, y: 120 + graph.nodes.length * 16 },
                          config: { ...(getNodeDefinition(node.type)?.defaults ?? {}) },
                        });
                        setLibrary(false);
                        select(nodeId);
                      }}
                    >
                      <View style={[styles.dot, { backgroundColor: node.color }]} />
                      <View style={styles.flex}>
                        <Text style={styles.libName}>{node.label}</Text>
                        <Text style={styles.libDesc}>{node.description}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 6 },
  name: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  webhook: { color: colors.muted, fontSize: 11, paddingHorizontal: 14, paddingBottom: 6 },
  add: {
    position: 'absolute',
    right: 18,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  library: { gap: 14 },
  libraryTitle: { color: colors.text, fontSize: 24, fontWeight: '700' },
  search: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  group: { gap: 8 },
  groupLabel: { color: colors.accent, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 },
  libRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  flex: { flex: 1 },
  libName: { color: colors.text, fontWeight: '700' },
  libDesc: { color: colors.muted, fontSize: 13 },
});
