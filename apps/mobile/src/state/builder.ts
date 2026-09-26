import type { Graph, GraphNode } from '@agents/shared';
import { create } from 'zustand';

interface BuilderState {
  graph: Graph;
  past: Graph[];
  future: Graph[];
  selectedId: string | null;
  connectingFrom: { nodeId: string; handle: string } | null;
  dirty: boolean;
  load: (graph: Graph) => void;
  beginHistory: () => void;
  moveNode: (id: string, x: number, y: number) => void;
  addNode: (node: GraphNode) => void;
  updateConfig: (id: string, config: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  addEdge: (source: string, sourceHandle: string, target: string) => void;
  removeEdge: (id: string) => void;
  select: (id: string | null) => void;
  beginConnect: (nodeId: string, handle: string) => void;
  cancelConnect: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  markDirty: () => void;
}

const empty: Graph = { nodes: [], edges: [] };

function clone(graph: Graph): Graph {
  return JSON.parse(JSON.stringify(graph)) as Graph;
}

export const useBuilder = create<BuilderState>((set, get) => ({
  graph: empty,
  past: [],
  future: [],
  selectedId: null,
  connectingFrom: null,
  dirty: false,
  load: (graph) => set({ graph: clone(graph), past: [], future: [], dirty: false, selectedId: null, connectingFrom: null }),
  beginHistory: () => {
    const { graph, past } = get();
    set({ past: [...past.slice(-40), clone(graph)], future: [] });
  },
  moveNode: (id, x, y) =>
    set((state) => ({
      dirty: true,
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((node) => (node.id === id ? { ...node, position: { x, y } } : node)),
      },
    })),
  addNode: (node) => change(set, get, (graph) => ({ ...graph, nodes: [...graph.nodes, node] }), node.id),
  updateConfig: (id, config) =>
    change(set, get, (graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === id ? { ...node, config } : node)),
    })),
  removeNode: (id) =>
    change(set, get, (graph) => ({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== id),
      edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id),
    })),
  addEdge: (source, sourceHandle, target) =>
    change(set, get, (graph) => {
      if (source === target) return graph;
      const exists = graph.edges.some(
        (edge) => edge.source === source && edge.sourceHandle === sourceHandle && edge.target === target,
      );
      if (exists) return graph;
      return {
        ...graph,
        edges: [
          ...graph.edges,
          {
            id: `e_${Math.random().toString(36).slice(2, 8)}`,
            source,
            sourceHandle,
            target,
            targetHandle: 'in',
          },
        ],
      };
    }),
  removeEdge: (id) => change(set, get, (graph) => ({ ...graph, edges: graph.edges.filter((edge) => edge.id !== id) })),
  select: (id) => set({ selectedId: id }),
  beginConnect: (nodeId, handle) => set({ connectingFrom: { nodeId, handle } }),
  cancelConnect: () => set({ connectingFrom: null }),
  undo: () => {
    const { past, graph, future } = get();
    const previous = past.at(-1);
    if (!previous) return;
    set({ graph: previous, past: past.slice(0, -1), future: [clone(graph), ...future], dirty: true, selectedId: null });
  },
  redo: () => {
    const { future, graph, past } = get();
    const next = future[0];
    if (!next) return;
    set({ graph: next, future: future.slice(1), past: [...past, clone(graph)], dirty: true });
  },
  markSaved: () => set({ dirty: false }),
  markDirty: () => set({ dirty: true }),
}));

function change(
  set: (partial: Partial<BuilderState> | ((state: BuilderState) => Partial<BuilderState>)) => void,
  get: () => BuilderState,
  recipe: (graph: Graph) => Graph,
  selectedId?: string,
) {
  const current = get();
  set({
    past: [...current.past.slice(-40), clone(current.graph)],
    future: [],
    graph: recipe(current.graph),
    dirty: true,
    connectingFrom: null,
    ...(selectedId ? { selectedId } : {}),
  });
}
