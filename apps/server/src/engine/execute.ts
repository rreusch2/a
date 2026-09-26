import {
  coerceConfig,
  getNodeDefinition,
  parseGraph,
  resolveTemplates,
  type Graph,
  type GraphNode,
  type NodeDefinition,
} from '@agents/shared';
import { actionSummary, addTokenUsage, branchHandle, performAction } from './actions.js';
import type {
  AgentFrame,
  Checkpoint,
  ExecuteOptions,
  ExecuteResult,
  ExecutionServices,
  LLMMessage,
  RunContext,
} from './types.js';

interface Outcome {
  data?: unknown;
  handle?: string;
  pause?: Checkpoint;
  failed?: string;
  cancelled?: boolean;
}

export async function executeGraph(options: ExecuteOptions): Promise<ExecuteResult> {
  const graph = parseGraph(options.graph);
  try {
    if (options.checkpoint && options.resume) {
      return resume(graph, options);
    }
    const ctx = emptyContext(options.input);
    const trigger = pickTrigger(graph, options.triggerNodeId);
    const first = await executeNode(graph, trigger, ctx, options, 0, undefined);
    if (first.pause) return waiting(first.pause, ctx);
    if (first.failed) return finish('failed', ctx, first.failed);
    if (first.cancelled) return finish('cancelled', ctx);
    const rest = await walk(graph, trigger, first.handle ?? 'out', ctx, options, [trigger.id], 0);
    return fromOutcome(rest, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The run failed.';
    const ctx = emptyContext(options.input);
    return finish('failed', ctx, message);
  }
}

async function resume(graph: Graph, options: ExecuteOptions): Promise<ExecuteResult> {
  const checkpoint = options.checkpoint;
  if (!checkpoint) return finish('failed', emptyContext(options.input), 'Nothing to resume.');
  const ctx = checkpoint.context;
  const source = graph.nodes.find((item) => item.id === checkpoint.nodeId);
  if (!source) return finish('failed', ctx, 'The paused step is no longer in the flow.');
  const node = checkpoint.agentFrame?.pendingToolArgs
    ? {
        ...source,
        config: {
          ...source.config,
          ...checkpoint.agentFrame.pendingToolArgs,
          confirm: source.config.confirm,
        },
      }
    : source;
  const approved = options.resume?.approved === true;

  if (checkpoint.kind === 'delay') {
    ctx.nodes[node.id] = { delayed: true, seconds: checkpoint.payload };
    ctx.handles[node.id] = 'out';
    const rest = await walk(graph, node, 'out', ctx, options, [node.id], 0);
    return fromOutcome(rest, ctx);
  }

  if (!approved) {
    if (checkpoint.kind === 'approval') {
      ctx.nodes[node.id] = { approved: false };
      ctx.handles[node.id] = 'rejected';
      await record(options.services, node, 'succeeded', checkpoint.payload, ctx.nodes[node.id]);
      const rest = await walk(graph, node, 'rejected', ctx, options, [node.id], 0);
      return fromOutcome(rest, ctx);
    }
    ctx.nodes[node.id] = { skipped: true };
    await record(options.services, node, 'succeeded', checkpoint.payload, ctx.nodes[node.id]);
    return finish('cancelled', ctx, 'You rejected this action.');
  }

  if (checkpoint.kind === 'approval') {
    ctx.nodes[node.id] = { approved: true };
    ctx.handles[node.id] = 'approved';
    await record(options.services, node, 'succeeded', checkpoint.payload, ctx.nodes[node.id]);
    const rest = await walk(graph, node, 'approved', ctx, options, [node.id], 0);
    return fromOutcome(rest, ctx);
  }

  const confirmed = { ...options, services: { ...options.services, confirmedNodeId: node.id } };
  const ran = await executeNode(graph, node, ctx, confirmed, 0, checkpoint.agentFrame);
  if (ran.pause) return waiting(ran.pause, ctx);
  if (ran.failed) return finish('failed', ctx, ran.failed);
  if (checkpoint.agentFrame) {
    const agent = graph.nodes.find((item) => item.id === checkpoint.agentFrame?.nodeId);
    if (!agent) return finish('failed', ctx, 'The agent step is missing.');
    const messages: LLMMessage[] = [
      ...checkpoint.agentFrame.messages,
      {
        role: 'tool',
        toolCallId: checkpoint.agentFrame.pendingToolCallId,
        content: JSON.stringify(ran.data ?? {}),
      },
    ];
    const continued = await runAgent(graph, agent, ctx, confirmed, {
      ...checkpoint.agentFrame,
      messages,
      pendingToolCallId: undefined,
    });
    if (continued.pause) return waiting(continued.pause, ctx);
    if (continued.failed) return finish('failed', ctx, continued.failed);
    const rest = await walk(graph, agent, 'out', ctx, options, [agent.id], 0);
    return fromOutcome(rest, ctx);
  }
  const rest = await walk(graph, node, ran.handle ?? 'out', ctx, options, [node.id], 0);
  return fromOutcome(rest, ctx);
}

async function walk(
  graph: Graph,
  node: GraphNode,
  handle: string,
  ctx: RunContext,
  options: ExecuteOptions,
  stack: string[],
  loopDepth: number,
): Promise<Outcome> {
  if (handle === 'tools') return {};
  if (await options.services.isCancelled()) return { cancelled: true };
  const edges = graph.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === handle);
  for (const edge of edges) {
    if (stack.includes(edge.target)) continue;
    const next = graph.nodes.find((item) => item.id === edge.target);
    if (!next) continue;
    const outcome = await executeNode(graph, next, ctx, options, loopDepth, undefined);
    if (outcome.pause || outcome.failed || outcome.cancelled) return outcome;
    const deeper = await walk(graph, next, outcome.handle ?? 'out', ctx, options, [...stack, next.id], loopDepth);
    if (deeper.pause || deeper.failed || deeper.cancelled) return deeper;
  }
  return {};
}

async function executeNode(
  graph: Graph,
  node: GraphNode,
  ctx: RunContext,
  options: ExecuteOptions,
  loopDepth: number,
  agentFrame: AgentFrame | undefined,
): Promise<Outcome> {
  const def = getNodeDefinition(node.type);
  if (!def) return { failed: `Unknown node ${node.type}.` };
  const started = options.services.now().toISOString();
  const config = resolveTemplates(coerceConfig(def.fields, node.config), ctx) as Record<string, unknown>;
  try {
    if (node.type === 'logic.approval') {
      if (loopDepth > 0) throw new Error('Put approval steps outside the loop.');
      const summary = String(config.summary ?? 'Approve this step?');
      await options.services.onApproval({ nodeId: node.id, summary, payload: { summary }, kind: 'approval' });
      await options.services.onStep({
        nodeId: node.id,
        nodeType: node.type,
        status: 'waiting',
        input: redact(config),
        output: null,
        startedAt: started,
        finishedAt: options.services.now().toISOString(),
      });
      return { pause: snapshotPause('approval', node.id, ctx, summary, { summary }, agentFrame) };
    }

    if (node.type === 'logic.delay') {
      const seconds = Math.min(86400, Math.max(0, Number(config.seconds ?? 0)));
      if (loopDepth > 0) throw new Error('Put delay steps outside the loop.');
      if (seconds > 2) {
        await options.services.onStep({
          nodeId: node.id,
          nodeType: node.type,
          status: 'waiting',
          input: { seconds },
          output: null,
          startedAt: started,
          finishedAt: options.services.now().toISOString(),
        });
        return { pause: snapshotPause('delay', node.id, ctx, `Wait ${seconds} seconds`, { seconds }, agentFrame) };
      }
    }

    if (node.type === 'logic.loop') {
      return runLoop(graph, node, config, ctx, options, loopDepth);
    }

    if (node.type === 'ai.agent') {
      return runAgent(graph, node, ctx, options, agentFrame);
    }

    if (needsConfirm(def, node, config, options.services)) {
      const summary = actionSummary(def, config);
      await options.services.onApproval({ nodeId: node.id, summary, payload: redact(config), kind: 'confirm' });
      await options.services.onStep({
        nodeId: node.id,
        nodeType: node.type,
        status: 'waiting',
        input: redact(config),
        output: null,
        startedAt: started,
        finishedAt: options.services.now().toISOString(),
      });
      return { pause: snapshotPause('confirm', node.id, ctx, summary, redact(config), agentFrame) };
    }

    if (options.services.dryRun && def.sideEffect && !isReadOnlyHttp(node.type, config)) {
      const data = { dryRun: true, would: redact(config) };
      ctx.nodes[node.id] = data;
      ctx.handles[node.id] = 'out';
      await record(options.services, node, 'succeeded', redact(config), data, started);
      return { data, handle: 'out' };
    }

    const data = await performAction(node.type, config, ctx, options.services);
    const handle = branchHandle(node.type, config, data);
    ctx.nodes[node.id] = data;
    ctx.handles[node.id] = handle;
    if (node.type.startsWith('trigger.')) ctx.trigger = data;
    await record(options.services, node, 'succeeded', redact(config), data, started);
    return { data, handle };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Step failed.';
    await options.services.onStep({
      nodeId: node.id,
      nodeType: node.type,
      status: 'failed',
      input: redact(config),
      output: null,
      error: message,
      startedAt: started,
      finishedAt: options.services.now().toISOString(),
    });
    return { failed: message };
  }
}

async function runLoop(
  graph: Graph,
  node: GraphNode,
  config: Record<string, unknown>,
  ctx: RunContext,
  options: ExecuteOptions,
  loopDepth: number,
): Promise<Outcome> {
  const started = options.services.now().toISOString();
  const items = Array.isArray(config.items) ? config.items : [];
  const max = Math.min(50, Math.max(1, Number(config.max ?? 25) || 25));
  const slice = items.slice(0, max);
  const outputs: unknown[] = [];
  for (let index = 0; index < slice.length; index += 1) {
    ctx.vars.item = slice[index];
    ctx.vars.index = index;
    const body = await walk(graph, node, 'each', ctx, options, [node.id], loopDepth + 1);
    if (body.pause || body.failed || body.cancelled) return body;
    outputs.push(ctx.vars.item);
  }
  const data = { count: slice.length, outputs };
  ctx.nodes[node.id] = data;
  ctx.handles[node.id] = 'done';
  await record(options.services, node, 'succeeded', redact(config), data, started);
  return { data, handle: 'done' };
}

async function runAgent(
  graph: Graph,
  node: GraphNode,
  ctx: RunContext,
  options: ExecuteOptions,
  frame: AgentFrame | undefined,
): Promise<Outcome> {
  const started = options.services.now().toISOString();
  const config = resolveTemplates(coerceConfig(getNodeDefinition(node.type)?.fields ?? [], node.config), ctx) as Record<
    string,
    unknown
  >;
  const tools = toolDefinitions(graph, node);
  const maxIterations = Math.min(8, Math.max(1, Number(frame?.maxIterations ?? config.maxIterations ?? 5) || 5));
  const messages: LLMMessage[] = frame?.messages ?? [
    {
      role: 'system',
      content: String(config.system ?? 'You finish the goal. Use tools when they help. Then answer in plain text.'),
    },
    { role: 'user', content: String(config.prompt ?? '') },
  ];
  let iteration = frame?.iteration ?? 0;
  let finalText = '';
  while (iteration < maxIterations) {
    const response = await options.services.llm({
      provider: config.provider === 'openai' ? 'openai' : 'anthropic',
      model: String(config.model ?? ''),
      messages,
      tools: tools.map((tool) => tool.schema),
    });
    addTokenUsage(ctx, response.usage);
    if (!response.toolCalls.length) {
      finalText = response.content;
      break;
    }
    messages.push({ role: 'assistant', content: response.content, toolCalls: response.toolCalls });
    for (const call of response.toolCalls) {
      const tool = tools.find((item) => item.name === call.name);
      if (!tool) {
        messages.push({ role: 'tool', toolCallId: call.id, content: `Unknown tool ${call.name}.` });
        continue;
      }
      const merged: GraphNode = {
        ...tool.node,
        config: { ...tool.node.config, ...call.arguments, confirm: tool.node.config.confirm },
      };
      const outcome = await executeNode(graph, merged, ctx, options, 0, {
        nodeId: node.id,
        messages,
        iteration,
        maxIterations,
        pendingToolCallId: call.id,
        pendingToolArgs: call.arguments,
      });
      if (outcome.pause) return outcome;
      if (outcome.failed) return outcome;
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.data ?? {}) });
    }
    iteration += 1;
  }
  const data = { text: finalText, iterations: iteration };
  ctx.nodes[node.id] = data;
  ctx.handles[node.id] = 'out';
  await record(options.services, node, 'succeeded', redact(config), data, started);
  return { data, handle: 'out' };
}

function toolDefinitions(graph: Graph, agent: GraphNode) {
  return graph.edges
    .filter((edge) => edge.source === agent.id && edge.sourceHandle === 'tools')
    .flatMap((edge) => {
      const node = graph.nodes.find((item) => item.id === edge.target);
      const def = node ? getNodeDefinition(node.type) : undefined;
      if (!node || !def?.asTool) return [];
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const field of def.fields) {
        properties[field.key] = {
          type: field.kind === 'number' ? 'number' : field.kind === 'boolean' ? 'boolean' : 'string',
          description: field.label,
        };
        if (field.required) required.push(field.key);
      }
      return [
        {
          node,
          name: node.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool',
          schema: {
            name: node.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'tool',
            description: def.asTool.description,
            parameters: { type: 'object', properties, required, additionalProperties: false },
          },
        },
      ];
    });
}

function needsConfirm(
  def: NodeDefinition,
  node: GraphNode,
  config: Record<string, unknown>,
  services: ExecutionServices,
): boolean {
  if (!def.sideEffect || services.dryRun) return false;
  if (services.confirmedNodeId === node.id) return false;
  if (config.confirm === false) return false;
  if (isReadOnlyHttp(node.type, config)) return false;
  return true;
}

function isReadOnlyHttp(type: string, config: Record<string, unknown>): boolean {
  return type === 'http.request' && String(config.method ?? 'GET').toUpperCase() === 'GET';
}

function pickTrigger(graph: Graph, triggerNodeId?: string): GraphNode {
  const triggers = graph.nodes.filter((node) => getNodeDefinition(node.type)?.category === 'trigger');
  const chosen = triggerNodeId ? triggers.find((node) => node.id === triggerNodeId) : triggers[0];
  if (!chosen) throw new Error('Add a trigger so the agent knows when to start.');
  return chosen;
}

function emptyContext(input: unknown): RunContext {
  return {
    trigger: input ?? {},
    nodes: {},
    vars: {},
    handles: {},
    tokenUsage: { input: 0, output: 0 },
  };
}

function snapshotPause(
  kind: Checkpoint['kind'],
  nodeId: string,
  ctx: RunContext,
  summary: string,
  payload: unknown,
  agentFrame?: AgentFrame,
): Checkpoint {
  return {
    kind,
    nodeId,
    context: structuredClone(ctx),
    summary,
    payload,
    agentFrame: agentFrame ? structuredClone(agentFrame) : undefined,
  };
}

async function record(
  services: ExecutionServices,
  node: GraphNode,
  status: 'succeeded' | 'failed' | 'waiting',
  input: unknown,
  output: unknown,
  startedAt = services.now().toISOString(),
): Promise<void> {
  await services.onStep({
    nodeId: node.id,
    nodeType: node.type,
    status,
    input,
    output,
    startedAt,
    finishedAt: services.now().toISOString(),
  });
}

function fromOutcome(outcome: Outcome, ctx: RunContext): ExecuteResult {
  if (outcome.pause) return waiting(outcome.pause, ctx);
  if (outcome.cancelled) return finish('cancelled', ctx, 'Stopped from the app.');
  if (outcome.failed) return finish('failed', ctx, outcome.failed);
  return finish('succeeded', ctx);
}

function waiting(checkpoint: Checkpoint, ctx: RunContext): ExecuteResult {
  const status = checkpoint.kind === 'delay' ? 'waiting_delay' : 'waiting_approval';
  return {
    status,
    context: ctx,
    output: { checkpoint },
    checkpoint,
    tokenUsage: ctx.tokenUsage,
  };
}

function finish(status: 'succeeded' | 'failed' | 'cancelled', ctx: RunContext, error?: string): ExecuteResult {
  return {
    status,
    context: ctx,
    output: ctx.nodes,
    error,
    tokenUsage: ctx.tokenUsage,
  };
}

function redact(config: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...config };
  if (typeof copy.headers === 'string') {
    copy.headers = copy.headers.replace(/(authorization\s*:\s*).+/gi, '$1***');
  }
  return copy;
}
