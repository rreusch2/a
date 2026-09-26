import type { ProviderId } from '@agents/shared';
import { PROVIDER_LABEL } from '@agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, Loading, Muted, Pill, Title } from '../../components/ui';
import { api } from '../../lib/api';
import { colors } from '../../theme';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  requiredProviders: ProviderId[];
  featured: boolean;
}

export default function TemplatesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api<{ templates: Template[] }>('/templates'),
  });
  const clone = useMutation({
    mutationFn: (id: string) =>
      api<{ agent: { id: string }; missingProviders: ProviderId[] }>(`/templates/${id}/clone`, { method: 'POST' }),
    onSuccess: ({ agent, missingProviders }) => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      if (missingProviders.length) {
        Alert.alert(
          'Connect these first',
          `${missingProviders.map((provider) => PROVIDER_LABEL[provider]).join(', ')} ${missingProviders.length === 1 ? 'is' : 'are'} not connected. The agent was saved as a draft.`,
          [
            { text: 'Edit draft', onPress: () => router.push(`/agents/${agent.id}/builder`) },
            { text: 'Connections', onPress: () => router.push('/connections') },
          ],
        );
        return;
      }
      router.push(`/agents/${agent.id}/builder`);
    },
    onError: (error: Error) => Alert.alert('Could not use this template', error.message),
  });

  if (templates.isLoading) return <Loading />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Title>Templates</Title>
        <Muted>Clone one, then change the prompts, channels, and schedules.</Muted>
      </View>
      <FlatList
        data={templates.data?.templates ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={templates.isRefetching}
        onRefresh={() => void templates.refetch()}
        ListEmptyComponent={<Empty title="No templates yet" body="Start the API once with Supabase configured and it will seed the gallery." />}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              {item.featured ? <Pill label="Featured" color={colors.accent} /> : null}
            </View>
            <Muted>{item.description}</Muted>
            <View style={styles.pills}>
              <Pill label={item.category} />
              {item.requiredProviders.map((provider) => (
                <Pill key={provider} label={PROVIDER_LABEL[provider]} />
              ))}
            </View>
            <Button label="Use template" onPress={() => clone.mutate(item.id)} disabled={clone.isPending} />
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 6 },
  list: { padding: 20, gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
