import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { env } from './env.js';
import type { LLMMessage, LLMRequest, LLMResponse } from './engine/types.js';

export async function chat(apiKey: string, request: LLMRequest): Promise<LLMResponse> {
  if (request.provider === 'openai') return openAiChat(apiKey, request);
  return anthropicChat(apiKey, request);
}

async function anthropicChat(apiKey: string, request: LLMRequest): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey });
  const system = request.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
  const messages: Anthropic.MessageParam[] = [];
  for (const message of request.messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      messages.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      messages.push({ role: 'assistant', content: content.length ? content : message.content || '' });
      continue;
    }
    const block: Anthropic.ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: message.toolCallId ?? '',
      content: message.content,
    };
    const previous = messages.at(-1);
    if (previous?.role === 'user' && Array.isArray(previous.content)) {
      previous.content.push(block);
    } else {
      messages.push({ role: 'user', content: [block] });
    }
  }
  const response = await client.messages.create({
    model: request.model || env.anthropicModel,
    max_tokens: request.maxTokens ?? 1024,
    system: system || undefined,
    tools: request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool.InputSchema,
    })),
    messages,
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const toolCalls = response.content
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: (block.input ?? {}) as Record<string, unknown>,
    }));
  return {
    content: text,
    toolCalls,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

async function openAiChat(apiKey: string, request: LLMRequest): Promise<LLMResponse> {
  const client = new OpenAI({ apiKey });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = request.messages.map((message) =>
    toOpenAiMessage(message),
  );
  const response = await client.chat.completions.create({
    model: request.model || env.openaiModel,
    messages,
    tools: request.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  });
  const choice = response.choices[0]?.message;
  const toolCalls = (choice?.tool_calls ?? []).flatMap((call) => {
    if (call.type !== 'function') return [];
    return [
      {
        id: call.id,
        name: call.function.name,
        arguments: parseArgs(call.function.arguments),
      },
    ];
  });
  return {
    content: choice?.content ?? '',
    toolCalls,
    usage: {
      input: response.usage?.prompt_tokens ?? 0,
      output: response.usage?.completion_tokens ?? 0,
    },
  };
}

function toOpenAiMessage(message: LLMMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  if (message.role === 'system') return { role: 'system', content: message.content };
  return { role: 'user', content: message.content };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
