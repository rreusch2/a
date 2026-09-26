import { Canvas, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useMemo } from 'react';
import { colors } from '../../theme';
import { useBuilder } from '../../state/builder';
import { edgePath } from './geometry';
import { NodeCard } from './NodeCard';

export function NodeCanvas({ activeNodeId, doneNodeIds }: { activeNodeId?: string | null; doneNodeIds: string[] }) {
  const nodes = useBuilder((state) => state.graph.nodes);
  const edges = useBuilder((state) => state.graph.edges);
  const selectedId = useBuilder((state) => state.selectedId);
  const connectingFrom = useBuilder((state) => state.connectingFrom);
  const cancelConnect = useBuilder((state) => state.cancelConnect);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(24);
  const scale = useSharedValue(1);

  const transform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ]);
  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));
  const path = useMemo(() => edgePath(edges, nodes), [edges, nodes]);
  const grid = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = -1200; x <= 1600; x += 48) lines.push({ x1: x, y1: -800, x2: x, y2: 1400 });
    for (let y = -800; y <= 1400; y += 48) lines.push({ x1: -1200, y1: y, x2: 1600, y2: y });
    return lines;
  }, []);

  const canvasGesture = Gesture.Simultaneous(
    Gesture.Pan().onChange((event) => {
      translateX.value += event.changeX;
      translateY.value += event.changeY;
    }),
    Gesture.Pinch().onChange((event) => {
      scale.value = Math.min(2.4, Math.max(0.4, scale.value * event.scaleChange));
    }),
  );

  return (
    <View style={styles.fill}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group transform={transform}>
          {grid.map((line) => (
            <Line
              key={`${line.x1}-${line.y1}-${line.x2}`}
              p1={vec(line.x1, line.y1)}
              p2={vec(line.x2, line.y2)}
              color="#1B2230"
              strokeWidth={1}
            />
          ))}
          {path ? <Path path={path} style="stroke" strokeWidth={2.5} color={colors.accent} /> : null}
        </Group>
      </Canvas>
      <GestureDetector gesture={canvasGesture}>
        <View style={styles.fill} />
      </GestureDetector>
      <Animated.View style={[styles.world, worldStyle]} pointerEvents="box-none">
        {nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            scale={scale}
            selected={node.id === selectedId}
            active={node.id === activeNodeId}
            done={doneNodeIds.includes(node.id)}
          />
        ))}
      </Animated.View>
      {connectingFrom ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Tap an input to connect, or tap the same port to cancel.</Text>
          <Text style={styles.bannerAction} onPress={cancelConnect}>
            Cancel
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  world: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  banner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerText: { color: colors.text, flex: 1 },
  bannerAction: { color: colors.accent, fontWeight: '700' },
});
