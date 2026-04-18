import { randomUUID } from 'node:crypto';

import { DEFAULT_SYSTEM_PROMPT } from './config';
import { AuthError, ProviderError } from './core/errors';

import type { AssistantMessage, UserMessage } from './agent/messages';
import type { HarnessRuntime } from './runtime';

export interface RunTextPromptParams {
  modelId: string;
  prompt: string;
  providerId: string;
  signal?: AbortSignal;
}

export interface RunTextPromptResult {
  assistant: AssistantMessage;
  responseText: string;
}

const getLatestAssistant = (
  current: AssistantMessage | null,
  next: AssistantMessage | null,
): AssistantMessage | null => next ?? current;

export const runTextPrompt = async (
  runtime: HarnessRuntime,
  params: RunTextPromptParams,
): Promise<RunTextPromptResult> => {
  const provider = runtime.providerRegistry.get(params.providerId);
  if (!provider) {
    throw new ProviderError(`Unknown provider: ${params.providerId}`);
  }

  const model = runtime.providerRegistry.findModel(params.providerId, params.modelId);
  if (!model) {
    throw new ProviderError(`Unknown model for ${params.providerId}: ${params.modelId}`);
  }

  const resolvedAuth = await runtime.authManager.resolve(params.providerId);
  if (!resolvedAuth) {
    throw new AuthError(`No auth configured for provider: ${params.providerId}`);
  }

  const userMessage: UserMessage = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: params.prompt }],
    timestamp: Date.now(),
  };

  let assistant: AssistantMessage | null = null;

  for await (const event of provider.transport.stream(
    model,
    {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      messages: [userMessage],
      tools: [],
    },
    {
      apiKey: resolvedAuth.apiKey,
      signal: params.signal,
    },
  )) {
    switch (event.type) {
      case 'start':
      case 'text_start':
      case 'text_delta':
      case 'text_end':
      case 'thinking_start':
      case 'thinking_delta':
      case 'thinking_end':
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end':
      case 'usage':
        assistant = getLatestAssistant(assistant, event.partial);
        break;
      case 'done':
        assistant = getLatestAssistant(assistant, event.message);
        break;
      case 'error':
        assistant = getLatestAssistant(assistant, event.error);
        break;
    }
  }

  if (!assistant) {
    throw new ProviderError('Model stream finished without an assistant message.');
  }

  const responseText = assistant.content
    .filter(
      (block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> =>
        block.type === 'text',
    )
    .map((block) => block.text)
    .join('\n\n');

  return {
    assistant,
    responseText,
  };
};
