import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ProviderId } from '@agents/shared';
import { env } from './env.js';
import { HttpError } from './http.js';

const DEFAULTS: Record<ProviderId, string> = {
  gmail: 'google-mail',
  gcal: 'google-calendar',
  slack: 'slack',
  notion: 'notion',
  excel: 'microsoft',
};

export function integrationId(provider: ProviderId): string {
  const override = process.env[`NANGO_INTEGRATION_${provider.toUpperCase()}`];
  return override || DEFAULTS[provider];
}

export function providerFromIntegration(id: string): ProviderId | null {
  const match = (Object.keys(DEFAULTS) as ProviderId[]).find((provider) => integrationId(provider) === id);
  return match ?? null;
}

function secret(): string {
  if (!env.nangoSecret) throw new HttpError(503, 'Set NANGO_SECRET_KEY to connect accounts.');
  return env.nangoSecret;
}

export async function createConnectSession(input: {
  userId: string;
  email: string | null;
  provider: ProviderId;
}): Promise<{ token: string; connectUrl: string }> {
  const integration = integrationId(input.provider);
  const response = await fetch(`${env.nangoHost}/connect/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      end_user: {
        id: input.userId,
        email: input.email ?? undefined,
      },
      allowed_integrations: [integration],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { token?: string; connect_link?: string };
    error?: { message?: string };
  };
  if (!response.ok || !body.data?.token) {
    throw new HttpError(502, body.error?.message ?? 'Nango could not start the connection.');
  }
  const token = body.data.token;
  const connectUrl = body.data.connect_link ?? `https://connect.nango.dev?session_token=${encodeURIComponent(token)}`;
  return { token, connectUrl };
}

export interface NangoConnection {
  connectionId: string;
  providerConfigKey: string;
  accountLabel: string | null;
}

export async function listNangoConnections(userId: string): Promise<NangoConnection[]> {
  const response = await fetch(`${env.nangoHost}/connections`, {
    headers: { Authorization: `Bearer ${secret()}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    connections?: Array<{
      connection_id?: string;
      provider_config_key?: string;
      end_user?: { id?: string; email?: string };
      tags?: Record<string, string>;
    }>;
  };
  if (!response.ok) throw new HttpError(502, 'Could not list Nango connections.');
  return (body.connections ?? [])
    .filter((connection) => (connection.end_user?.id ?? connection.tags?.end_user_id) === userId)
    .map((connection) => ({
      connectionId: connection.connection_id ?? '',
      providerConfigKey: connection.provider_config_key ?? '',
      accountLabel: connection.end_user?.email ?? null,
    }))
    .filter((connection) => connection.connectionId && connection.providerConfigKey);
}

export async function nangoProxy(
  connectionId: string,
  providerConfigKey: string,
  path: string,
  init: { method: string; body?: unknown; headers?: Record<string, string> },
): Promise<unknown> {
  const url = `${env.nangoHost}/proxy${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Provider-Config-Key': providerConfigKey,
      'Connection-Id': connectionId,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: init.body == null || init.method === 'GET' ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const data = text ? safeJson(text) : null;
  if (!response.ok) {
    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const message = String(
      (record && 'message' in record ? record.message : '') ||
        (record && 'error' in record ? JSON.stringify(record.error) : '') ||
        text ||
        `Upstream request failed (${response.status}).`,
    );
    throw new Error(message.slice(0, 500));
  }
  return data;
}

export function verifyNangoWebhook(rawBody: string, signature: string | undefined): boolean {
  if (!env.nangoSecret || !signature) return false;
  const digest = createHmac('sha256', env.nangoSecret).update(rawBody).digest('hex');
  const candidates = [digest, createHmac('sha256', env.nangoSecret).update(rawBody).digest('base64')];
  return candidates.some((candidate) => safeEqual(candidate, signature));
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
