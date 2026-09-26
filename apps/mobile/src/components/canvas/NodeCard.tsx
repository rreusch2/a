import { getNodeDefinition, type GraphNode } from '@agents/shared';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useRef } from 'react';
import { NODE_H, NODE_W, colors } from '../../theme';
import { useBuilder } from '../../state/builder';

export function NodeCard({
  node,
  scale,
  selected,
  active,
  done,
}: {
  node: GraphNode;
  scale: SharedValue<number>;
  selected: boolean;
  active: boolean;
  done: boolean;
}) {
  const def = getNodeDefinition(node.type);
  const moveNode = useBuilder((state) => state.moveNode);
  const beginHistory = useBuilder((state) => state.beginHistory);
  const select = useBuilder((state) => state.select);
  const beginConnect = useBuilder((state) => state.beginConnect);
  const addEdge = useBuilder((state) => state.addEdge);
  const connectingFrom = useBuilder((state) => state.connectingFrom);
  const cancelConnect = useBuilder((state) => state.cancelConnect);
  const origin = useRef({ x: node.position.x, y: node.position.y });

  const drag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(8)
    .onStart(() => {
      origin.current = { x: node.position.x, y: node.position.y };
      beginHistory();
    })
    .onUpdate((event) => {
      const zoom = scale.value || 1;
      moveNode(node.id, origin.current.x + event.translationX / zoom, origin.current.y + event.translationY / zoom);
    });

  if (!def) return null;
  const border = active ? colors.accent : selected ? colors.text : done ? colors.ok : colors.line;

  return (
    <GestureDetector gesture={drag}>
      <View style={[styles.card, { left: node.position.x, top: node.position.y, borderColor: border }]}>
        <Pressable onPress={() => select(node.id)} style={styles.body}>
          <View style={[styles.icon, { backgroundColor: def.color }]}>
            <Ionicons name={def.icon as keyof typeof Ionicons.glyphMap} size={16} color="#141820" />
          </View>
          <View style={styles.copy}>
            <Text style={styles.label} numberOfLines={1}>
              {def.label}
            </Text>
            <Text style={styles.id} numberOfLines={1}>
              {node.id}
            </Text>
          </View>
        </Pressable>
        {def.inputs.length ? (
          <Pressable
            style={[styles.port, styles.portIn, connectingFrom && styles.portHot]}
            onPress={() => {
              if (!connectingFrom) return;
              addEdge(connectingFrom.nodeId, connectingFrom.handle, node.id);
            }}
          />
        ) : null}
        <View style={styles.outputs}>
          {def.outputs.map((port) => (
            <Pressable
              key={port.id}
              onPress={() => {
                if (connectingFrom?.nodeId === node.id && connectingFrom.handle === port.id) cancelConnect();
                else beginConnect(node.id, port.id);
              }}
              style={styles.outputRow}
            >
              <Text style={styles.portLabel}>{port.label}</Text>
              <View
                style={[
                  styles.port,
                  connectingFrom?.nodeId === node.id && connectingFrom.handle === port.id && styles.portArmed,
                ]}
              />
            </Pressable>
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: NODE_W,
    minHeight: NODE_H,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 10,
  },
  body: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingRight: 54 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  label: { color: colors.text, fontWeight: '700', fontSize: 15 },
  id: { color: colors.muted, fontSize: 11 },
  port: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#1A1408',
  },
  portIn: { position: 'absolute', left: -8, top: NODE_H / 2 - 7 },
  portHot: { backgroundColor: colors.ok },
  portArmed: { backgroundColor: colors.ok },
  outputs: { position: 'absolute', right: -8, top: 18, gap: 8, alignItems: 'flex-end' },
  outputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  portLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
});
