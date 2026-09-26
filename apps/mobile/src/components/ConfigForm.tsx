import { getNodeDefinition, type FieldDef } from '@agents/shared';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme';
import { useBuilder } from '../state/builder';
import { Button } from './ui';

export function ConfigForm({ nodeId }: { nodeId: string }) {
  const node = useBuilder((state) => state.graph.nodes.find((item) => item.id === nodeId));
  const edges = useBuilder((state) => state.graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId));
  const updateConfig = useBuilder((state) => state.updateConfig);
  const removeNode = useBuilder((state) => state.removeNode);
  const removeEdge = useBuilder((state) => state.removeEdge);
  const select = useBuilder((state) => state.select);
  if (!node) return null;
  const def = getNodeDefinition(node.type);
  if (!def) return null;

  function setValue(key: string, value: unknown) {
    if (!node) return;
    updateConfig(node.id, { ...node.config, [key]: value });
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>{def.category}</Text>
      <Text style={styles.title}>{def.label}</Text>
      <Text style={styles.help}>{def.description}</Text>
      <Text style={styles.id}>Reference this step as {`{{nodes.${node.id}}}`}</Text>
      {def.fields.map((field) => (
        <FieldEditor key={field.key} field={field} value={node.config[field.key]} onChange={(value) => setValue(field.key, value)} />
      ))}
      {def.sideEffect ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>Confirm before running</Text>
            <Text style={styles.help}>The agent pauses on your phone before this action.</Text>
          </View>
          <Switch
            value={node.config.confirm !== false}
            onValueChange={(value) => setValue('confirm', value)}
            trackColor={{ true: colors.accent, false: colors.line }}
          />
        </View>
      ) : null}
      {edges.length ? (
        <View style={styles.block}>
          <Text style={styles.label}>Connections</Text>
          {edges.map((edge) => (
            <Pressable key={edge.id} onPress={() => removeEdge(edge.id)} style={styles.edge}>
              <Text style={styles.edgeText}>
                {edge.source === node.id ? `Out ${edge.sourceHandle} → ${edge.target}` : `In from ${edge.source}`}
              </Text>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Button
        label="Delete step"
        tone="danger"
        onPress={() => {
          removeNode(node.id);
          select(null);
        }}
      />
    </View>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === 'boolean') {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{field.label}</Text>
        <Switch value={value === true} onValueChange={onChange} />
      </View>
    );
  }
  if (field.kind === 'select') {
    return (
      <View style={styles.block}>
        <Text style={styles.label}>{field.label}</Text>
        <View style={styles.chips}>
          {field.options.map((option) => {
            const selected = value === option.value || (value == null && option.value === field.options[0]?.value);
            return (
              <Pressable
                key={option.value}
                onPress={() => onChange(option.value)}
                style={[styles.chip, selected && styles.chipOn]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  const text = value == null ? '' : String(value);
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{field.label}</Text>
      <BottomSheetInput
        value={text}
        onChangeText={(next) => onChange(field.kind === 'number' ? next : next)}
        placeholder={'placeholder' in field ? field.placeholder : undefined}
        multiline={field.kind === 'textarea' || field.kind === 'json'}
      />
      {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
    </View>
  );
}

function BottomSheetInput(props: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <BottomSheetTextInput
      {...props}
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      style={[styles.input, props.multiline && styles.multiline]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  kicker: { color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  help: { color: colors.muted, lineHeight: 18, fontSize: 13 },
  id: { color: colors.text, fontSize: 12 },
  label: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  block: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  flex: { flex: 1, gap: 4 },
  input: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600' },
  chipTextOn: { color: '#1A1408' },
  edge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  edgeText: { color: colors.text },
  remove: { color: colors.danger, fontWeight: '700' },
});
