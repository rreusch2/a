import { getNodeDefinition, type GraphEdge, type GraphNode } from '@agents/shared';
import { NODE_H, NODE_W } from '../../theme';

export function portPoint(node: GraphNode, handle: string, side: 'in' | 'out'): { x: number; y: number } {
  const def = getNodeDefinition(node.type);
  const ports = side === 'in' ? (def?.inputs ?? []) : (def?.outputs ?? []);
  const index = Math.max(0, ports.findIndex((port) => port.id === handle));
  const count = Math.max(ports.length, 1);
  const y = node.position.y + ((index + 1) * NODE_H) / (count + 1);
  const x = side === 'in' ? node.position.x : node.position.x + NODE_W;
  return { x, y };
}

export function edgePath(edges: GraphEdge[], nodes: GraphNode[]): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges
    .map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return '';
      const from = portPoint(source, edge.sourceHandle, 'out');
      const to = portPoint(target, edge.targetHandle, 'in');
      const bend = Math.max(48, Math.abs(to.x - from.x) / 2);
      return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
    })
    .filter(Boolean)
    .join(' ');
}
