import { describe, expect, it } from 'vitest';
import type { Graph, ProviderId } from '@agents/shared';
import { blockedUrl } from './actions.js';
import { executeGraph } from './execute.js';
import type { ConnectionRef, ExecutionServices, LLMRequest, LLMResponse, StepEvent } from './types.js';

function graph(nodes: Graph['nodes'], edges: Graph['edges'] = []): Graph {
  return { nodes, edges };
}

function services(overrides: Partial<ExecutionServices> = {}): ExecutionServices & { steps: StepEvent[]; approvals: string[] } {
  const steps: StepEvent[] = [];
  const approvals: string[] = [];
  const base: ExecutionServices = {
    dryRun: false,
    now: () => new Date('2026-09-26T12:00:00Z'),
    fetchImpl: async () => new Response('ok', { status: 200 }),
    isCancelled: async () => false,
    resolveConnection: async (provider: ProviderId) =>
      ({
        id: 'c1',
        provider,
        nangoConnectionId: 'nango',
        providerConfigKey: provider,
        accessMode: 'read_write',
      }) satisfies ConnectionRef,
    nangoProxy: async () => ({ id: 'sent' }),
    llm: async (request: LLMRequest): Promise<LLMResponse> => ({
      content: `echo:${request.messages.at(-1)?.content ?? ''}`,
      toolCalls: [],
    }),
    onStep: async (step) => {
      steps.push(step);
    },
    onApproval: async (event) => {
      approvals.push(event.summary);
    },
  };
  return { ...base, ...overrides, steps, approvals, onStep: overrides.onStep ?? base.onStep, onApproval: overrides.onApproval ?? base.onApproval };
}

describe('executeGraph', () => {
  it('runs a manual trigger through a variable and the true branch', async () => {
    const svc = services();
    const result = await executeGraph({
      input: { topic: 'launch' },
      services: svc,
      graph: graph(
        [
          { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'save', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'topic', value: '{{nodes.start.topic}}' } },
          { id: 'gate', type: 'logic.if', position: { x: 0, y: 0 }, config: { left: '{{vars.topic}}', operator: 'eq', right: 'launch' } },
          { id: 'yes', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'path', value: 'yes' } },
          { id: 'no', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'path', value: 'no' } },
        ],
        [
          { id: 'e1', source: 'start', sourceHandle: 'out', target: 'save', targetHandle: 'in' },
          { id: 'e2', source: 'save', sourceHandle: 'out', target: 'gate', targetHandle: 'in' },
          { id: 'e3', source: 'gate', sourceHandle: 'true', target: 'yes', targetHandle: 'in' },
          { id: 'e4', source: 'gate', sourceHandle: 'false', target: 'no', targetHandle: 'in' },
        ],
      ),
    });
    expect(result.status).toBe('succeeded');
    expect(result.context.vars.path).toBe('yes');
    expect(result.context.nodes.no).toBeUndefined();
  });

  it('loops each item and then continues on done', async () => {
    const svc = services();
    const result = await executeGraph({
      input: { rows: ['a', 'b'] },
      services: svc,
      graph: graph(
        [
          { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'loop', type: 'logic.loop', position: { x: 0, y: 0 }, config: { items: '{{nodes.start.rows}}', max: 10 } },
          { id: 'mark', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'last', value: '{{vars.item}}' } },
          { id: 'after', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'done', value: '{{nodes.loop.count}}' } },
        ],
        [
          { id: 'e1', source: 'start', sourceHandle: 'out', target: 'loop', targetHandle: 'in' },
          { id: 'e2', source: 'loop', sourceHandle: 'each', target: 'mark', targetHandle: 'in' },
          { id: 'e3', source: 'loop', sourceHandle: 'done', target: 'after', targetHandle: 'in' },
        ],
      ),
    });
    expect(result.status).toBe('succeeded');
    expect(result.context.vars.last).toBe('b');
    expect(result.context.vars.done).toBe(2);
  });

  it('pauses for approval and resumes down the approved branch', async () => {
    const flow = graph(
      [
        { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
        { id: 'ask', type: 'logic.approval', position: { x: 0, y: 0 }, config: { summary: 'Send it?' } },
        { id: 'go', type: 'logic.set_variable', position: { x: 0, y: 0 }, config: { name: 'sent', value: 'yes' } },
      ],
      [
        { id: 'e1', source: 'start', sourceHandle: 'out', target: 'ask', targetHandle: 'in' },
        { id: 'e2', source: 'ask', sourceHandle: 'approved', target: 'go', targetHandle: 'in' },
      ],
    );
    const paused = await executeGraph({ input: {}, services: services(), graph: flow });
    expect(paused.status).toBe('waiting_approval');
    expect(paused.checkpoint?.summary).toBe('Send it?');
    const resumed = await executeGraph({
      input: {},
      services: services(),
      graph: flow,
      checkpoint: paused.checkpoint,
      resume: { approved: true },
    });
    expect(resumed.status).toBe('succeeded');
    expect(resumed.context.vars.sent).toBe('yes');
  });

  it('stubs side effects during a test run and still allows GET', async () => {
    let fetched = 0;
    let proxied = 0;
    const svc = services({
      dryRun: true,
      fetchImpl: async () => {
        fetched += 1;
        return new Response('page', { status: 200 });
      },
      nangoProxy: async () => {
        proxied += 1;
        return { id: 'nope' };
      },
    });
    const result = await executeGraph({
      input: {},
      services: svc,
      graph: graph(
        [
          { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'mail', type: 'gmail.send', position: { x: 0, y: 0 }, config: { to: 'a@b.co', subject: 'Hi', body: 'There', confirm: false } },
          { id: 'page', type: 'http.request', position: { x: 0, y: 0 }, config: { method: 'GET', url: 'https://example.com' } },
        ],
        [
          { id: 'e1', source: 'start', sourceHandle: 'out', target: 'mail', targetHandle: 'in' },
          { id: 'e2', source: 'mail', sourceHandle: 'out', target: 'page', targetHandle: 'in' },
        ],
      ),
    });
    expect(result.status).toBe('succeeded');
    expect(proxied).toBe(0);
    expect(fetched).toBe(1);
    expect(result.context.nodes.mail).toMatchObject({ dryRun: true });
    expect(result.context.nodes.page).toMatchObject({ body: 'page' });
  });

  it('lets an agent call a connected tool', async () => {
    const calls: string[] = [];
    const svc = services({
      llm: async (request) => {
        const hasToolResult = request.messages.some((message) => message.role === 'tool');
        if (!hasToolResult) {
          return {
            content: '',
            toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { url: 'https://example.com/item' } }],
          };
        }
        return { content: 'Found it.', toolCalls: [] };
      },
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response('item', { status: 200 });
      },
    });
    const result = await executeGraph({
      input: {},
      services: svc,
      graph: graph(
        [
          { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'agent', type: 'ai.agent', position: { x: 0, y: 0 }, config: { provider: 'anthropic', prompt: 'Look it up', maxIterations: 3 } },
          { id: 'lookup', type: 'http.request', position: { x: 0, y: 0 }, config: { method: 'GET', url: 'https://example.com', confirm: false } },
        ],
        [
          { id: 'e1', source: 'start', sourceHandle: 'out', target: 'agent', targetHandle: 'in' },
          { id: 'e2', source: 'agent', sourceHandle: 'tools', target: 'lookup', targetHandle: 'in' },
        ],
      ),
    });
    expect(result.status).toBe('succeeded');
    expect(calls).toEqual(['https://example.com/item']);
    expect(result.context.nodes.agent).toMatchObject({ text: 'Found it.' });
  });

  it('asks before a live send and queues a long delay', async () => {
    const svc = services();
    const paused = await executeGraph({
      input: {},
      services: svc,
      graph: graph(
        [
          { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'mail', type: 'gmail.send', position: { x: 0, y: 0 }, config: { to: 'a@b.co', subject: 'Hi', body: 'There' } },
        ],
        [{ id: 'e1', source: 'start', sourceHandle: 'out', target: 'mail', targetHandle: 'in' }],
      ),
    });
    expect(paused.status).toBe('waiting_approval');
    expect(paused.checkpoint?.kind).toBe('confirm');

    const delayed = await executeGraph({
      input: {},
      services: services(),
      graph: graph(
        [
          { id: 'start', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'wait', type: 'logic.delay', position: { x: 0, y: 0 }, config: { seconds: 30 } },
        ],
        [{ id: 'e1', source: 'start', sourceHandle: 'out', target: 'wait', targetHandle: 'in' }],
      ),
    });
    expect(delayed.status).toBe('waiting_delay');
  });
});

describe('blockedUrl', () => {
  it('blocks loopback and metadata addresses', () => {
    expect(blockedUrl('http://127.0.0.1/latest')).toMatch(/blocked/);
    expect(blockedUrl('http://169.254.169.254/')).toMatch(/blocked/);
    expect(blockedUrl('https://example.com')).toBeNull();
  });
});
