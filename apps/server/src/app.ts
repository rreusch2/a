import {
  graphSchema,
  starterGraph,
  validateGraph,
  type Graph,
  type ProviderId,
} from '@agents/shared';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { asAuthed, requireUser, sendError, type AuthedRequest } from './auth.js';
import { encryptSecret } from './crypto.js';
import { createAdminClient } from './db.js';
import { env } from './env.js';
import { activateAgent, createAgentRun, handleSlackEvent, pauseAgent, publishAgent } from './engine/runs.js';
import { HttpError } from './http.js';
import {
  createConnectSession,
  listNangoConnections,
  providerFromIntegration,
  verifyNangoWebhook,
} from './nango.js';
import { enqueue } from './queue.js';

const providerSchema = z.enum(['gmail', 'gcal', 'slack', 'notion', 'excel']);

export function createApp(): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',') }));
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
      },
    }),
  );
  app.use(rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, queue: env.redisUrl ? 'redis' : 'memory' });
  });

  app.post('/hooks/:triggerId', async (req, res, next) => {
    try {
      const admin = createAdminClient();
      const secret = req.header('x-webhook-secret');
      const { data: trigger } = await admin.from('triggers').select('*').eq('id', req.params.triggerId).maybeSingle();
      if (!trigger?.enabled || !secret || secret !== trigger.webhook_secret) {
        throw new HttpError(401, 'Unauthorized.');
      }
      const { data: agent } = await admin.from('agents').select('*').eq('id', trigger.agent_id).single();
      if (!agent || agent.status !== 'active') throw new HttpError(409, 'That agent is not running.');
      const run = await createAgentRun({
        agent,
        dryRun: false,
        triggerType: 'webhook',
        triggerNodeId: trigger.node_id as string,
        payload: req.body ?? {},
      });
      res.status(202).json({ runId: run.id });
    } catch (error) {
      next(error);
    }
  });

  app.post('/nango/webhook', async (req, res, next) => {
    try {
      const raw = (req as Request & { rawBody?: string }).rawBody ?? '';
      if (!verifyNangoWebhook(raw, req.header('x-nango-hmac-sha256'))) {
        throw new HttpError(401, 'Invalid signature.');
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const connectionId = String(body.connectionId ?? body.connection_id ?? '');
      const payload = (body.payload ?? body) as Record<string, unknown>;
      const event = (payload.event ?? payload) as Record<string, unknown>;
      if (connectionId && event && typeof event === 'object') {
        await handleSlackEvent(connectionId, event);
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use(requireUser);

  app.get('/me', async (req, res, next) => {
    try {
      const { user, supabase } = asAuthed(req);
      const [{ data: profile }, { data: keys }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        createAdminClient().from('llm_credentials').select('provider').eq('user_id', user.id),
      ]);
      const saved = new Set((keys ?? []).map((row) => row.provider as string));
      res.json({
        id: user.id,
        email: user.email,
        displayName: profile?.display_name ?? '',
        plan: profile?.plan ?? 'free',
        expoPushToken: profile?.expo_push_token ?? null,
        llmKeys: { anthropic: saved.has('anthropic'), openai: saved.has('openai') },
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/me', async (req, res, next) => {
    try {
      const body = z
        .object({
          displayName: z.string().max(80).optional(),
          expoPushToken: z.string().max(256).nullable().optional(),
        })
        .parse(req.body);
      const { user, supabase } = asAuthed(req);
      const update: Record<string, unknown> = {};
      if (body.displayName != null) update.display_name = body.displayName;
      if (body.expoPushToken !== undefined) update.expo_push_token = body.expoPushToken;
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) throw new HttpError(400, error.message);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put('/me/llm-keys', async (req, res, next) => {
    try {
      const body = z
        .object({ provider: z.enum(['anthropic', 'openai']), apiKey: z.string().min(10).max(400) })
        .parse(req.body);
      const admin = createAdminClient();
      const { error } = await admin.from('llm_credentials').upsert(
        {
          user_id: asAuthed(req).user.id,
          provider: body.provider,
          encrypted_key: encryptSecret(body.apiKey),
        },
        { onConflict: 'user_id,provider' },
      );
      if (error) throw new HttpError(400, error.message);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/me/llm-keys/:provider', async (req, res, next) => {
    try {
      const provider = z.enum(['anthropic', 'openai']).parse(req.params.provider);
      const admin = createAdminClient();
      await admin.from('llm_credentials').delete().eq('user_id', asAuthed(req).user.id).eq('provider', provider);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/agents', async (req, res, next) => {
    try {
      const { supabase } = asAuthed(req);
      const { data: agents, error } = await supabase.from('agents').select('*').order('updated_at', { ascending: false });
      if (error) throw new HttpError(400, error.message);
      const ids = (agents ?? []).map((agent) => agent.id as string);
      const { data: runs } = ids.length
        ? await supabase.from('runs').select('agent_id, status, created_at').in('agent_id', ids).order('created_at', { ascending: false }).limit(200)
        : { data: [] };
      res.json({
        agents: (agents ?? []).map((agent) => {
          const related = (runs ?? []).filter((run) => run.agent_id === agent.id);
          const recent = related.slice(0, 20);
          const succeeded = recent.filter((run) => run.status === 'succeeded').length;
          return {
            ...presentAgent(agent),
            lastRunAt: related[0]?.created_at ?? null,
            lastStatus: related[0]?.status ?? null,
            successRate: recent.length ? succeeded / recent.length : null,
          };
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/agents', async (req, res, next) => {
    try {
      const body = z.object({ name: z.string().min(1).max(80), icon: z.string().max(40).optional(), color: z.string().max(20).optional() }).parse(req.body ?? {});
      const { user, supabase } = asAuthed(req);
      const { data, error } = await supabase
        .from('agents')
        .insert({
          user_id: user.id,
          name: body.name,
          icon: body.icon ?? 'sparkles',
          color: body.color ?? '#F2B544',
          draft_graph: starterGraph(),
        })
        .select('*')
        .single();
      if (error || !data) throw new HttpError(400, error?.message ?? 'Could not create the agent.');
      res.status(201).json({ agent: presentAgent(data) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/agents/:id', async (req, res, next) => {
    try {
      const agent = await loadAgent(asAuthed(req), req.params.id);
      const { data: triggers } = await asAuthed(req).supabase.from('triggers').select('*').eq('agent_id', agent.id);
      res.json({
        agent: presentAgent(agent),
        triggers: (triggers ?? []).map((trigger) => ({
          id: trigger.id,
          nodeId: trigger.node_id,
          type: trigger.type,
          enabled: trigger.enabled,
          webhookUrl: trigger.webhook_secret ? `${env.publicUrl}/hooks/${trigger.id}` : null,
          webhookSecret: trigger.webhook_secret,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/agents/:id', async (req, res, next) => {
    try {
      const body = z
        .object({
          name: z.string().min(1).max(80).optional(),
          icon: z.string().max(40).optional(),
          color: z.string().max(20).optional(),
          draftGraph: graphSchema.optional(),
        })
        .parse(req.body ?? {});
      if (body.draftGraph) {
        const issues = validateGraph(body.draftGraph, 'draft');
        if (issues.length) throw new HttpError(400, issues[0]?.message ?? 'Invalid flow.');
      }
      const agent = await loadAgent(asAuthed(req), req.params.id);
      const update: Record<string, unknown> = {};
      if (body.name) update.name = body.name;
      if (body.icon) update.icon = body.icon;
      if (body.color) update.color = body.color;
      if (body.draftGraph) update.draft_graph = body.draftGraph;
      const { data, error } = await asAuthed(req).supabase.from('agents').update(update).eq('id', agent.id).select('*').single();
      if (error || !data) throw new HttpError(400, error?.message ?? 'Could not save.');
      res.json({ agent: presentAgent(data) });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/agents/:id', async (req, res, next) => {
    try {
      const agent = await loadAgent(asAuthed(req), req.params.id);
      await pauseAgent(agent);
      const { error } = await asAuthed(req).supabase.from('agents').delete().eq('id', agent.id);
      if (error) throw new HttpError(400, error.message);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/agents/:id/publish', async (req, res, next) => {
    try {
      const agent = await loadAgent(asAuthed(req), req.params.id);
      const published = await publishAgent(agent);
      res.json(published);
    } catch (error) {
      next(error);
    }
  });

  app.post('/agents/:id/activate', async (req, res, next) => {
    try {
      const agent = await loadAgent(asAuthed(req), req.params.id);
      await activateAgent(agent);
      res.json({ status: 'active' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/agents/:id/pause', async (req, res, next) => {
    try {
      const agent = await loadAgent(asAuthed(req), req.params.id);
      await pauseAgent(agent);
      res.json({ status: 'paused' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/agents/:id/runs', async (req, res, next) => {
    try {
      const body = z.object({ dryRun: z.boolean().optional(), input: z.unknown().optional() }).parse(req.body ?? {});
      const agent = await loadAgent(asAuthed(req), req.params.id);
      const graph = (body.dryRun ? agent.draft_graph : agent.draft_graph) as Graph;
      const manual = graph.nodes?.find((node) => node.type === 'trigger.manual');
      const sample = manual?.config?.sampleInput;
      const run = await createAgentRun({
        agent,
        dryRun: body.dryRun === true,
        triggerType: body.dryRun ? 'test' : 'manual',
        triggerNodeId: manual?.id,
        payload: body.input ?? (body.dryRun ? sample ?? {} : {}),
      });
      res.status(202).json({ runId: run.id });
    } catch (error) {
      next(error);
    }
  });

  app.get('/runs', async (req, res, next) => {
    try {
      const { supabase } = asAuthed(req);
      const { data, error } = await supabase.from('runs').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw new HttpError(400, error.message);
      res.json({ runs: (data ?? []).map(presentRun) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/runs/:id', async (req, res, next) => {
    try {
      const { supabase } = asAuthed(req);
      const { data: run, error } = await supabase.from('runs').select('*').eq('id', req.params.id).maybeSingle();
      if (error) throw new HttpError(400, error.message);
      if (!run) throw new HttpError(404, 'Run not found.');
      const { data: steps } = await supabase
        .from('run_steps')
        .select('*')
        .eq('run_id', run.id)
        .order('started_at', { ascending: true });
      res.json({
        run: presentRun(run),
        steps: (steps ?? []).map((step) => ({
          id: step.id,
          nodeId: step.node_id,
          nodeType: step.node_type,
          status: step.status,
          input: step.input,
          output: step.output,
          error: step.error,
          startedAt: step.started_at,
          finishedAt: step.finished_at,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/approvals', async (req, res, next) => {
    try {
      const status = z.enum(['pending', 'approved', 'rejected']).optional().parse(req.query.status);
      const { supabase } = asAuthed(req);
      let query = supabase.from('approvals').select('*').order('created_at', { ascending: false }).limit(50);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw new HttpError(400, error.message);
      res.json({ approvals: (data ?? []).map(presentApproval) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/approvals/:id/decide', async (req, res, next) => {
    try {
      const body = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(req.body);
      const { supabase } = asAuthed(req);
      const { data: approval } = await supabase.from('approvals').select('*').eq('id', req.params.id).maybeSingle();
      if (!approval) throw new HttpError(404, 'Approval not found.');
      if (approval.status !== 'pending') throw new HttpError(409, 'That decision was already made.');
      const admin = createAdminClient();
      await admin
        .from('approvals')
        .update({ status: body.decision, decided_at: new Date().toISOString() })
        .eq('id', approval.id);
      await enqueue({
        kind: 'resume',
        runId: approval.run_id as string,
        approved: body.decision === 'approved',
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/connections', async (req, res, next) => {
    try {
      const { data, error } = await asAuthed(req).supabase.from('connections').select('*').order('created_at', { ascending: false });
      if (error) throw new HttpError(400, error.message);
      res.json({ connections: (data ?? []).map(presentConnection) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/connections/session', async (req, res, next) => {
    try {
      const body = z
        .object({
          provider: providerSchema,
          accessMode: z.enum(['read', 'read_write']).default('read'),
        })
        .parse(req.body);
      const { user } = asAuthed(req);
      const session = await createConnectSession({ userId: user.id, email: user.email, provider: body.provider });
      res.json({ ...session, provider: body.provider, accessMode: body.accessMode });
    } catch (error) {
      next(error);
    }
  });

  app.post('/connections/sync', async (req, res, next) => {
    try {
      const body = z
        .object({
          provider: providerSchema.optional(),
          accessMode: z.enum(['read', 'read_write']).optional(),
        })
        .parse(req.body ?? {});
      const { user } = asAuthed(req);
      const remote = await listNangoConnections(user.id);
      const admin = createAdminClient();
      for (const item of remote) {
        const provider = providerFromIntegration(item.providerConfigKey);
        if (!provider) continue;
        if (body.provider && provider !== body.provider) continue;
        await admin.from('connections').upsert(
          {
            user_id: user.id,
            provider,
            nango_connection_id: item.connectionId,
            account_label: item.accountLabel,
            access_mode: body.accessMode ?? 'read',
          },
          { onConflict: 'user_id,provider,nango_connection_id' },
        );
      }
      const { data } = await asAuthed(req).supabase.from('connections').select('*').order('created_at', { ascending: false });
      res.json({ connections: (data ?? []).map(presentConnection) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/connections/:id', async (req, res, next) => {
    try {
      const body = z.object({ accessMode: z.enum(['read', 'read_write']) }).parse(req.body);
      const { data: existing } = await asAuthed(req).supabase.from('connections').select('id').eq('id', req.params.id).maybeSingle();
      if (!existing) throw new HttpError(404, 'Connection not found.');
      const { error } = await createAdminClient().from('connections').update({ access_mode: body.accessMode }).eq('id', existing.id);
      if (error) throw new HttpError(400, error.message);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/connections/:id', async (req, res, next) => {
    try {
      const { data: existing } = await asAuthed(req).supabase.from('connections').select('id').eq('id', req.params.id).maybeSingle();
      if (!existing) throw new HttpError(404, 'Connection not found.');
      await createAdminClient().from('connections').delete().eq('id', existing.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/templates', async (req, res, next) => {
    try {
      const { data, error } = await asAuthed(req).supabase.from('templates').select('*').order('featured', { ascending: false });
      if (error) throw new HttpError(400, error.message);
      res.json({
        templates: (data ?? []).map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          graph: template.graph,
          requiredProviders: template.required_providers ?? [],
          featured: template.featured,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/templates/:id/clone', async (req, res, next) => {
    try {
      const { user, supabase } = asAuthed(req);
      const { data: template } = await supabase.from('templates').select('*').eq('id', req.params.id).maybeSingle();
      if (!template) throw new HttpError(404, 'Template not found.');
      const required = (template.required_providers ?? []) as ProviderId[];
      const { data: connections } = required.length
        ? await supabase.from('connections').select('provider').in('provider', required)
        : { data: [] };
      const have = new Set((connections ?? []).map((row) => row.provider as string));
      const missing = required.filter((provider) => !have.has(provider));
      const { data, error } = await supabase
        .from('agents')
        .insert({
          user_id: user.id,
          name: template.name as string,
          icon: 'sparkles',
          color: '#F2B544',
          draft_graph: template.graph,
        })
        .select('*')
        .single();
      if (error || !data) throw new HttpError(400, error?.message ?? 'Could not clone the template.');
      res.status(201).json({ agent: presentAgent(data), missingProviders: missing });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }
    sendError(error, res);
  });

  return app;
}

async function loadAgent(req: AuthedRequest, id: string | undefined) {
  if (!id) throw new HttpError(400, 'Missing agent id.');
  const { data, error } = await req.supabase.from('agents').select('*').eq('id', id).maybeSingle();
  if (error) throw new HttpError(400, error.message);
  if (!data) throw new HttpError(404, 'Agent not found.');
  return data as {
    id: string;
    user_id: string;
    name: string;
    icon: string;
    color: string;
    status: 'draft' | 'active' | 'paused';
    active_version_id: string | null;
    draft_graph: Graph;
    created_at: string;
    updated_at: string;
  };
}

function presentAgent(agent: Record<string, unknown>) {
  return {
    id: agent.id,
    name: agent.name,
    icon: agent.icon,
    color: agent.color,
    status: agent.status,
    activeVersionId: agent.active_version_id,
    draftGraph: agent.draft_graph,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };
}

function presentRun(run: Record<string, unknown>) {
  return {
    id: run.id,
    agentId: run.agent_id,
    versionId: run.version_id,
    triggerType: run.trigger_type,
    triggerNodeId: run.trigger_node_id,
    status: run.status,
    input: run.input,
    output: run.output,
    error: run.error,
    tokenUsage: run.token_usage,
    dryRun: run.dry_run,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
  };
}

function presentApproval(approval: Record<string, unknown>) {
  return {
    id: approval.id,
    runId: approval.run_id,
    nodeId: approval.node_id,
    summary: approval.action_summary,
    payload: approval.payload,
    status: approval.status,
    decidedAt: approval.decided_at,
    createdAt: approval.created_at,
  };
}

function presentConnection(connection: Record<string, unknown>) {
  return {
    id: connection.id,
    provider: connection.provider,
    accountLabel: connection.account_label,
    scopes: connection.scopes ?? [],
    accessMode: connection.access_mode,
    createdAt: connection.created_at,
  };
}
