import { randomBytes } from 'node:crypto';
import {
  assertCron,
  getNodeDefinition,
  starterGraph,
  validateGraph,
  type Graph,
  type ProviderId,
} from '@agents/shared';
import { createAdminClient } from '../db.js';
import { HttpError } from '../http.js';
import { integrationId, nangoProxy } from '../nango.js';
import { decryptSecret } from '../crypto.js';
import { chat } from '../llm.js';
import { notifyUser } from '../push.js';
import { enqueue, schedule, unschedule, type JobData } from '../queue.js';
import { normalizeGmail } from './actions.js';
import { executeGraph } from './execute.js';
import type { ConnectionRef, ExecutionServices } from './types.js';

interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused';
  active_version_id: string | null;
  draft_graph: Graph;
}

interface RunRow {
  id: string;
  agent_id: string;
  user_id: string;
  version_id: string | null;
  trigger_type: string;
  trigger_node_id: string | null;
  status: string;
  input: unknown;
  output: { checkpoint?: import('./types.js').Checkpoint } | null;
  dry_run: boolean;
  started_at: string | null;
}

export async function processJob(job: JobData): Promise<void> {
  if (job.kind === 'tick' && job.triggerId) {
    await tickTrigger(job.triggerId);
    return;
  }
  if (job.runId && (job.kind === 'run' || job.kind === 'resume')) {
    await performRun(job.runId, job.kind === 'resume' ? { approved: job.approved !== false } : undefined);
  }
}

export async function createAgentRun(input: {
  agent: AgentRow;
  dryRun: boolean;
  payload?: unknown;
  triggerType: string;
  triggerNodeId?: string;
}): Promise<{ id: string }> {
  const admin = createAdminClient();
  let versionId: string | null = null;
  let graph = input.agent.draft_graph;
  if (!input.dryRun) {
    if (input.agent.status !== 'active') throw new HttpError(400, 'Turn the agent on before a live run.');
    if (!input.agent.active_version_id) throw new HttpError(400, 'Publish the agent before a live run.');
    const { data: version, error } = await admin
      .from('agent_versions')
      .select('id, graph')
      .eq('id', input.agent.active_version_id)
      .single();
    if (error || !version) throw new HttpError(400, 'The published version is missing.');
    versionId = version.id as string;
    graph = version.graph as Graph;
    const issues = validateGraph(graph, 'publish');
    if (issues.length) throw new HttpError(400, issues[0]?.message ?? 'The flow is not ready.');
  }
  const triggerNodeId =
    input.triggerNodeId ??
    (input.triggerType === 'manual' || input.triggerType === 'test'
      ? graph.nodes.find((node) => node.type === 'trigger.manual')?.id
      : undefined);
  const { data, error } = await admin
    .from('runs')
    .insert({
      agent_id: input.agent.id,
      user_id: input.agent.user_id,
      version_id: versionId,
      trigger_type: input.triggerType,
      trigger_node_id: triggerNodeId ?? null,
      status: 'queued',
      input: input.payload ?? {},
      dry_run: input.dryRun,
    })
    .select('id')
    .single();
  if (error || !data) throw new HttpError(500, error?.message ?? 'Could not start the run.');
  await enqueue({ kind: 'run', runId: data.id as string });
  return { id: data.id as string };
}

export async function performRun(runId: string, resume?: { approved: boolean }): Promise<void> {
  const admin = createAdminClient();
  const { data: run } = await admin.from('runs').select('*').eq('id', runId).maybeSingle();
  if (!run) return;
  const row = run as RunRow;
  if (['cancelled', 'succeeded', 'failed'].includes(row.status)) return;
  if (row.status === 'waiting_approval' && !resume) return;

  const { data: agentRow } = await admin.from('agents').select('*').eq('id', row.agent_id).maybeSingle();
  if (!agentRow) return;
  const agent = agentRow as AgentRow;
  let graph = agent.draft_graph ?? starterGraph();
  if (!row.dry_run && row.version_id) {
    const { data: version } = await admin.from('agent_versions').select('graph').eq('id', row.version_id).maybeSingle();
    if (version?.graph) graph = version.graph as Graph;
  }

  await admin
    .from('runs')
    .update({ status: 'running', started_at: row.started_at ?? new Date().toISOString(), error: null })
    .eq('id', runId);

  const services = await buildServices(row);
  const checkpoint = row.output?.checkpoint ?? null;
  const result = await executeGraph({
    graph,
    input: row.input ?? {},
    triggerNodeId: row.trigger_node_id ?? undefined,
    services,
    checkpoint,
    resume,
  });

  if (result.status === 'waiting_delay' && result.checkpoint) {
    await admin
      .from('runs')
      .update({ status: 'running', output: { checkpoint: result.checkpoint }, token_usage: result.tokenUsage })
      .eq('id', runId);
    const seconds = Number((result.checkpoint.payload as { seconds?: number } | null)?.seconds ?? 1);
    await enqueue({ kind: 'resume', runId, approved: true }, { delayMs: Math.max(1, seconds) * 1000 });
    return;
  }

  if (result.status === 'waiting_approval' && result.checkpoint) {
    await admin
      .from('runs')
      .update({
        status: 'waiting_approval',
        output: { checkpoint: result.checkpoint },
        token_usage: result.tokenUsage,
      })
      .eq('id', runId);
    await notifyUser(row.user_id, 'Approval needed', result.checkpoint.summary, { runId });
    return;
  }

  const status = result.status === 'waiting_delay' || result.status === 'waiting_approval' ? 'failed' : result.status;
  await admin
    .from('runs')
    .update({
      status,
      output: result.output,
      error: result.error ?? null,
      token_usage: result.tokenUsage,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (status === 'failed') {
    await notifyUser(row.user_id, `${agent.name} failed`, result.error ?? 'Open the run to see the step that failed.', {
      runId,
    });
  }
}

async function buildServices(run: RunRow): Promise<ExecutionServices> {
  const admin = createAdminClient();
  return {
    dryRun: run.dry_run,
    now: () => new Date(),
    fetchImpl: fetch,
    isCancelled: async () => {
      const { data } = await admin.from('runs').select('status').eq('id', run.id).maybeSingle();
      return data?.status === 'cancelled';
    },
    resolveConnection: (provider, connectionId) => resolveConnection(run.user_id, provider, connectionId),
    nangoProxy: (connection, path, init) => nangoProxy(connection.nangoConnectionId, connection.providerConfigKey, path, init),
    llm: async (request) => {
      const key = await llmKey(run.user_id, request.provider);
      return chat(key, request);
    },
    onStep: async (step) => {
      await admin.from('run_steps').insert({
        run_id: run.id,
        user_id: run.user_id,
        node_id: step.nodeId,
        node_type: step.nodeType,
        status: step.status,
        input: step.input,
        output: step.output,
        error: step.error ?? null,
        started_at: step.startedAt,
        finished_at: step.finishedAt,
      });
    },
    onApproval: async (event) => {
      await admin.from('approvals').insert({
        run_id: run.id,
        user_id: run.user_id,
        node_id: event.nodeId,
        action_summary: event.summary,
        payload: event.payload,
        status: 'pending',
      });
    },
  };
}

async function resolveConnection(
  userId: string,
  provider: ProviderId,
  connectionId?: string,
): Promise<ConnectionRef | null> {
  const admin = createAdminClient();
  let query = admin.from('connections').select('*').eq('user_id', userId).eq('provider', provider);
  if (connectionId) query = query.eq('id', connectionId);
  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    provider,
    nangoConnectionId: data.nango_connection_id as string,
    providerConfigKey: integrationId(provider),
    accessMode: data.access_mode as 'read' | 'read_write',
  };
}

async function llmKey(userId: string, provider: 'anthropic' | 'openai'): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('llm_credentials')
    .select('encrypted_key')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (data?.encrypted_key) return decryptSecret(data.encrypted_key as string);
  const fallback = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!fallback) throw new Error(`Add a ${provider === 'anthropic' ? 'Claude' : 'OpenAI'} key in Settings.`);
  return fallback;
}

export async function publishAgent(agent: AgentRow): Promise<{ versionId: string; version: number }> {
  const issues = validateGraph(agent.draft_graph, 'publish');
  if (issues.length) throw new HttpError(400, issues.map((issue) => issue.message).join(' '));
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('agent_versions')
    .select('version')
    .eq('agent_id', agent.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = Number(existing?.version ?? 0) + 1;
  const { data, error } = await admin
    .from('agent_versions')
    .insert({
      agent_id: agent.id,
      user_id: agent.user_id,
      version,
      graph: agent.draft_graph,
    })
    .select('id')
    .single();
  if (error || !data) throw new HttpError(500, error?.message ?? 'Could not publish.');
  const { error: updateError } = await admin.from('agents').update({ active_version_id: data.id }).eq('id', agent.id);
  if (updateError) throw new HttpError(500, updateError.message);
  return { versionId: data.id as string, version };
}

export async function activateAgent(agent: AgentRow): Promise<void> {
  if (!agent.active_version_id) throw new HttpError(400, 'Publish the agent before turning it on.');
  const admin = createAdminClient();
  const { data: version } = await admin.from('agent_versions').select('graph').eq('id', agent.active_version_id).single();
  if (!version?.graph) throw new HttpError(400, 'The published version is missing.');
  await syncTriggers(agent, version.graph as Graph, true);
  const { error } = await admin.from('agents').update({ status: 'active' }).eq('id', agent.id);
  if (error) throw new HttpError(500, error.message);
}

export async function pauseAgent(agent: AgentRow): Promise<void> {
  const admin = createAdminClient();
  await syncTriggers(agent, agent.draft_graph, false);
  await admin.from('agents').update({ status: 'paused' }).eq('id', agent.id);
  const now = new Date().toISOString();
  const { data: openRuns } = await admin
    .from('runs')
    .select('id')
    .eq('agent_id', agent.id)
    .in('status', ['queued', 'running', 'waiting_approval']);
  const ids = (openRuns ?? []).map((run) => run.id as string);
  if (ids.length) {
    await admin
      .from('runs')
      .update({ status: 'cancelled', finished_at: now, error: 'Stopped from the app.' })
      .in('id', ids);
    await admin
      .from('approvals')
      .update({ status: 'rejected', decided_at: now })
      .eq('status', 'pending')
      .in('run_id', ids);
  }
}

async function syncTriggers(agent: AgentRow, graph: Graph, enabled: boolean): Promise<void> {
  const admin = createAdminClient();
  const { data: existingRows } = await admin.from('triggers').select('*').eq('agent_id', agent.id);
  const existing = new Map((existingRows ?? []).map((row) => [row.node_id as string, row]));
  const triggerNodes = (graph.nodes ?? []).filter((node) => getNodeDefinition(node.type)?.category === 'trigger');
  const keep = new Set<string>();

  if (enabled) {
    for (const node of triggerNodes) {
      keep.add(node.id);
      const previous = existing.get(node.id);
      const webhookSecret =
        node.type === 'trigger.webhook'
          ? ((previous?.webhook_secret as string | null) ?? randomBytes(24).toString('hex'))
          : null;
      const row = {
        agent_id: agent.id,
        user_id: agent.user_id,
        node_id: node.id,
        type: node.type,
        config: node.config ?? {},
        webhook_secret: webhookSecret,
        enabled: node.type !== 'trigger.manual',
      };
      if (previous) {
        await admin.from('triggers').update(row).eq('id', previous.id);
      } else {
        await admin.from('triggers').insert(row);
      }
    }
  }

  const { data: latest } = await admin.from('triggers').select('*').eq('agent_id', agent.id);
  for (const trigger of latest ?? []) {
    const id = trigger.id as string;
    const shouldRun = enabled && keep.has(trigger.node_id as string) && trigger.type !== 'trigger.manual';
    if (!shouldRun) {
      await admin.from('triggers').update({ enabled: false }).eq('id', id);
      await unschedule(`trigger:${id}`);
      continue;
    }
    if (trigger.type === 'trigger.schedule') {
      const cron = String((trigger.config as { cron?: string } | null)?.cron ?? '');
      assertCron(cron);
      await schedule(`trigger:${id}`, cron, { kind: 'tick', triggerId: id });
    } else if (trigger.type === 'trigger.gmail_new_email' || trigger.type === 'trigger.notion_item_added') {
      await schedule(`trigger:${id}`, '*/2 * * * *', { kind: 'tick', triggerId: id });
    } else {
      await unschedule(`trigger:${id}`);
    }
  }
}

async function tickTrigger(triggerId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: trigger } = await admin.from('triggers').select('*').eq('id', triggerId).maybeSingle();
  if (!trigger?.enabled) return;
  const { data: agentRow } = await admin.from('agents').select('*').eq('id', trigger.agent_id).maybeSingle();
  if (!agentRow || agentRow.status !== 'active') return;
  const agent = agentRow as AgentRow;
  if (trigger.type === 'trigger.schedule') {
    await createAgentRun({
      agent,
      dryRun: false,
      triggerType: 'schedule',
      triggerNodeId: trigger.node_id as string,
      payload: { firedAt: new Date().toISOString() },
    });
    return;
  }
  if (trigger.type === 'trigger.gmail_new_email') await pollGmail(agent, trigger);
  if (trigger.type === 'trigger.notion_item_added') await pollNotion(agent, trigger);
}

async function pollGmail(agent: AgentRow, trigger: Record<string, unknown>): Promise<void> {
  const connection = await resolveConnection(agent.user_id, 'gmail');
  if (!connection) return;
  const config = (trigger.config ?? {}) as { query?: string };
  const cursor = (trigger.cursor ?? {}) as { initialized?: boolean; seenIds?: string[] };
  const query = config.query || 'is:inbox';
  const listed = (await nangoProxy(
    connection.nangoConnectionId,
    connection.providerConfigKey,
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
    { method: 'GET' },
  )) as { messages?: { id: string }[] };
  const ids = (listed.messages ?? []).map((message) => message.id).filter(Boolean);
  const seen = new Set(cursor.seenIds ?? []);
  if (!cursor.initialized) {
    await saveCursor(trigger.id as string, { initialized: true, seenIds: ids });
    return;
  }
  for (const id of ids.filter((item) => !seen.has(item)).slice(0, 5)) {
    const full = await nangoProxy(
      connection.nangoConnectionId,
      connection.providerConfigKey,
      `/gmail/v1/users/me/messages/${id}?format=full`,
      { method: 'GET' },
    );
    await createAgentRun({
      agent,
      dryRun: false,
      triggerType: 'gmail',
      triggerNodeId: trigger.node_id as string,
      payload: normalizeGmail(full),
    });
  }
  await saveCursor(trigger.id as string, { initialized: true, seenIds: [...new Set([...ids, ...seen])].slice(0, 100) });
}

async function pollNotion(agent: AgentRow, trigger: Record<string, unknown>): Promise<void> {
  const connection = await resolveConnection(agent.user_id, 'notion');
  if (!connection) return;
  const config = (trigger.config ?? {}) as { databaseId?: string };
  const cursor = (trigger.cursor ?? {}) as { since?: string };
  const since = cursor.since ?? new Date().toISOString();
  if (!cursor.since) {
    await saveCursor(trigger.id as string, { since });
    return;
  }
  if (!config.databaseId) return;
  const result = (await nangoProxy(
    connection.nangoConnectionId,
    connection.providerConfigKey,
    `/v1/databases/${config.databaseId}/query`,
    {
      method: 'POST',
      headers: { 'Notion-Version': '2022-06-28' },
      body: {
        page_size: 10,
        filter: { timestamp: 'last_edited_time', last_edited_time: { after: since } },
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      },
    },
  )) as { results?: Record<string, unknown>[] };
  for (const page of result.results ?? []) {
    await createAgentRun({
      agent,
      dryRun: false,
      triggerType: 'notion',
      triggerNodeId: trigger.node_id as string,
      payload: { id: page.id, url: page.url, title: page.id },
    });
  }
  await saveCursor(trigger.id as string, { since: new Date().toISOString() });
}

async function saveCursor(triggerId: string, cursor: unknown): Promise<void> {
  const admin = createAdminClient();
  await admin.from('triggers').update({ cursor }).eq('id', triggerId);
}

export async function handleSlackEvent(connectionId: string, event: Record<string, unknown>): Promise<void> {
  if (event.type !== 'message' || event.bot_id || event.subtype) return;
  const admin = createAdminClient();
  const { data: connection } = await admin
    .from('connections')
    .select('*')
    .eq('nango_connection_id', connectionId)
    .eq('provider', 'slack')
    .maybeSingle();
  if (!connection) return;
  const { data: triggers } = await admin
    .from('triggers')
    .select('*')
    .eq('user_id', connection.user_id)
    .eq('type', 'trigger.slack_message')
    .eq('enabled', true);
  for (const trigger of triggers ?? []) {
    const channel = (trigger.config as { channel?: string } | null)?.channel;
    if (channel && channel !== event.channel) continue;
    const { data: agentRow } = await admin.from('agents').select('*').eq('id', trigger.agent_id).maybeSingle();
    if (!agentRow || agentRow.status !== 'active') continue;
    await createAgentRun({
      agent: agentRow as AgentRow,
      dryRun: false,
      triggerType: 'slack',
      triggerNodeId: trigger.node_id as string,
      payload: {
        channel: event.channel ?? '',
        user: event.user ?? '',
        text: event.text ?? '',
        ts: event.ts ?? '',
      },
    });
  }
}
