import type { Graph, ProviderId } from '@agents/shared';

export interface RunContext {
  trigger: unknown;
  nodes: Record<string, unknown>;
  vars: Record<string, unknown>;
  handles: Record<string, string>;
  tokenUsage: { input: number; output: number };
}

export interface ConnectionRef {
  id: string;
  provider: ProviderId;
  nangoConnectionId: string;
  providerConfigKey: string;
  accessMode: 'read' | 'read_write';
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  toolCallId?: string;
}

export interface LLMRequest {
  provider: 'anthropic' | 'openai';
  model?: string;
  messages: LLMMessage[];
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
  usage?: { input: number; output: number };
}

export interface StepEvent {
  nodeId: string;
  nodeType: string;
  status: 'succeeded' | 'failed' | 'waiting';
  input: unknown;
  output: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export interface ApprovalEvent {
  nodeId: string;
  summary: string;
  payload: unknown;
  kind: 'approval' | 'confirm';
}

export interface AgentFrame {
  nodeId: string;
  messages: LLMMessage[];
  iteration: number;
  maxIterations: number;
  pendingToolCallId?: string;
  pendingToolArgs?: Record<string, unknown>;
}

export interface Checkpoint {
  kind: 'approval' | 'confirm' | 'delay';
  nodeId: string;
  context: RunContext;
  summary: string;
  payload: unknown;
  agentFrame?: AgentFrame;
}

export interface ExecutionServices {
  dryRun: boolean;
  confirmedNodeId?: string;
  resolveConnection: (provider: ProviderId, connectionId?: string) => Promise<ConnectionRef | null>;
  nangoProxy: (
    connection: ConnectionRef,
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<unknown>;
  llm: (request: LLMRequest) => Promise<LLMResponse>;
  fetchImpl: typeof fetch;
  now: () => Date;
  isCancelled: () => Promise<boolean>;
  onStep: (step: StepEvent) => Promise<void>;
  onApproval: (event: ApprovalEvent) => Promise<void>;
}

export interface ExecuteOptions {
  graph: Graph;
  input: unknown;
  triggerNodeId?: string;
  services: ExecutionServices;
  checkpoint?: Checkpoint | null;
  resume?: { approved: boolean };
}

export interface ExecuteResult {
  status: 'succeeded' | 'failed' | 'waiting_approval' | 'waiting_delay' | 'cancelled';
  context: RunContext;
  output: unknown;
  error?: string;
  checkpoint?: Checkpoint;
  tokenUsage: { input: number; output: number };
}
