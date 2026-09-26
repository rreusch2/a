import { z } from 'zod';
import { coerceConfig } from './nodes/define.js';
import { getNodeDefinition } from './nodes/catalog.js';

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  config: z.record(z.unknown()).default({}),
});

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1).default('out'),
  target: z.string().min(1),
  targetHandle: z.string().min(1).default('in'),
});

export const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .optional(),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type Graph = z.infer<typeof graphSchema>;

export function parseGraph(input: unknown): Graph {
  return graphSchema.parse(input);
}

export function starterGraph(): Graph {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger.manual',
        position: { x: 48, y: 180 },
        config: {},
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export interface GraphIssue {
  message: string;
  nodeId?: string;
}

export function validateGraph(input: unknown, mode: 'draft' | 'publish'): GraphIssue[] {
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    return [{ message: 'The graph is not valid JSON for a flow.' }];
  }
  const graph = parsed.data;
  const issues: GraphIssue[] = [];
  if (graph.nodes.length > 60) {
    issues.push({ message: 'A flow can have at most 60 nodes.' });
  }
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) issues.push({ message: `Duplicate node id ${node.id}.`, nodeId: node.id });
    ids.add(node.id);
    const def = getNodeDefinition(node.type);
    if (!def) {
      issues.push({ message: `Unknown node type ${node.type}.`, nodeId: node.id });
      continue;
    }
    const config = coerceConfig(def.fields, node.config);
    const result = def.configSchema.safeParse(config);
    if (!result.success) {
      issues.push({ message: `${def.label} has invalid settings.`, nodeId: node.id });
    }
    if (mode === 'publish') {
      for (const field of def.fields) {
        if (!field.required) continue;
        const value = config[field.key];
        if (value == null || (typeof value === 'string' && value.trim() === '')) {
          issues.push({ message: `${def.label} is missing ${field.label}.`, nodeId: node.id });
        }
      }
    }
  }
  const triggers = graph.nodes.filter((node) => getNodeDefinition(node.type)?.category === 'trigger');
  if (mode === 'publish' && triggers.length === 0) {
    issues.push({ message: 'Add a trigger so the agent knows when to start.' });
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({ message: 'An edge points at a missing node.' });
      continue;
    }
    const source = graph.nodes.find((node) => node.id === edge.source);
    const target = graph.nodes.find((node) => node.id === edge.target);
    const sourceDef = source ? getNodeDefinition(source.type) : undefined;
    const targetDef = target ? getNodeDefinition(target.type) : undefined;
    if (sourceDef && !sourceDef.outputs.some((port) => port.id === edge.sourceHandle)) {
      issues.push({ message: `${sourceDef.label} has no output named ${edge.sourceHandle}.`, nodeId: source?.id });
    }
    if (targetDef && !targetDef.inputs.some((port) => port.id === edge.targetHandle)) {
      issues.push({ message: `${targetDef.label} has no input named ${edge.targetHandle}.`, nodeId: target?.id });
    }
    if (targetDef?.category === 'trigger') {
      issues.push({ message: 'Triggers start a run. They cannot receive a connection.', nodeId: target?.id });
    }
  }
  return issues;
}
