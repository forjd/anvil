import { randomUUID } from 'node:crypto';

import { buildOpenAICodexRequestBody } from './mapper';
import { ProviderError } from '../../core/errors';

import type { AssistantStreamEvent } from '../../agent/events';
import type { AssistantMessage } from '../../agent/messages';
import type { ProviderTransport } from '../types';

const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';

const createAssistantMessage = (provider: string, model: string): AssistantMessage => ({
  id: randomUUID(),
  role: 'assistant',
  content: [],
  provider,
  model,
  stopReason: 'stop',
  timestamp: Date.now(),
});

const resolveCodexResponsesUrl = (baseUrl?: string): string => {
  const normalized = (baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/, '');

  if (normalized.endsWith('/codex/responses')) {
    return normalized;
  }

  if (normalized.endsWith('/codex')) {
    return `${normalized}/responses`;
  }

  return `${normalized}/codex/responses`;
};

const createNotImplementedError = (): ProviderError =>
  new ProviderError(
    'OpenAI Codex transport is scaffolded but not implemented yet. The next step is wiring fetch + SSE parsing into AssistantStreamEvent output.',
  );

export const openAICodexTransport: ProviderTransport = {
  async *stream(model, context, options): AsyncIterable<AssistantStreamEvent> {
    await Promise.resolve();

    const assistant = createAssistantMessage(model.provider, model.id);
    yield { type: 'start', partial: assistant };

    try {
      if (!options.apiKey) {
        throw new ProviderError('Missing API key / access token for OpenAI Codex transport.');
      }

      const requestBody = buildOpenAICodexRequestBody(model, context, options);
      const requestUrl = resolveCodexResponsesUrl(model.baseUrl);
      void requestBody;
      void requestUrl;

      throw createNotImplementedError();
    } catch (error) {
      assistant.stopReason = options.signal?.aborted ? 'aborted' : 'error';
      assistant.errorMessage = error instanceof Error ? error.message : String(error);

      yield {
        type: 'error',
        reason: assistant.stopReason === 'aborted' ? 'aborted' : 'error',
        error: assistant,
      };
    }
  },
};
