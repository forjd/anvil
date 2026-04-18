import { randomUUID } from 'node:crypto';

import { buildOpenAICodexRequestBody } from './mapper';
import { ProviderError } from '../../core/errors';

import type { AssistantStreamEvent } from '../../agent/events';
import type { AssistantMessage } from '../../agent/messages';
import type { ProviderTransport } from '../types';

const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const OPENAI_BETA_HEADER = 'responses=experimental';
const USER_AGENT = `Anvil (${process.platform}; ${process.arch})`;

type JsonRecord = Record<string, unknown>;

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

const decodeJwtPayload = (token: string): JsonRecord => {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new ProviderError('Failed to decode the OpenAI access token.');
  }

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JsonRecord;
  } catch (error) {
    throw new ProviderError('Failed to decode the OpenAI access token.', { cause: error });
  }
};

const extractAccountId = (token: string): string => {
  const payload = decodeJwtPayload(token);
  const auth = payload[JWT_CLAIM_PATH];

  if (!auth || typeof auth !== 'object') {
    throw new ProviderError('OpenAI access token did not include ChatGPT account metadata.');
  }

  const accountId = (auth as JsonRecord).chatgpt_account_id;
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new ProviderError('OpenAI access token did not include a ChatGPT account id.');
  }

  return accountId;
};

const createRequestId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `codex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const buildSSEHeaders = (
  initHeaders: Record<string, string> | undefined,
  additionalHeaders: Record<string, string> | undefined,
  accountId: string,
  token: string,
  sessionId?: string,
): Headers => {
  const headers = new Headers(initHeaders);

  for (const [key, value] of Object.entries(additionalHeaders ?? {})) {
    headers.set(key, value);
  }

  headers.set('Authorization', `Bearer ${token}`);
  headers.set('chatgpt-account-id', accountId);
  headers.set('originator', 'anvil');
  headers.set('OpenAI-Beta', OPENAI_BETA_HEADER);
  headers.set('accept', 'text/event-stream');
  headers.set('content-type', 'application/json');
  headers.set('user-agent', USER_AGENT);

  const requestId = sessionId ?? createRequestId();
  headers.set('session_id', requestId);
  headers.set('x-client-request-id', requestId);

  return headers;
};

const parseErrorResponse = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => '');
  if (!body) {
    return `OpenAI Codex request failed with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // ignore invalid json and fall back to the raw body
  }

  return body;
};

const safeParseJson = (value: string): Record<string, unknown> => {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const mapStopReason = (status: string | undefined): AssistantMessage['stopReason'] => {
  switch (status) {
    case undefined:
    case 'completed':
    case 'in_progress':
    case 'queued':
      return 'stop';
    case 'incomplete':
      return 'length';
    case 'failed':
    case 'cancelled':
      return 'error';
    default:
      return 'stop';
  }
};

const extractOutputText = (item: JsonRecord): string => {
  const content = item.content;
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      const typedPart = part as JsonRecord;
      if (typedPart.type === 'output_text' && typeof typedPart.text === 'string') {
        return typedPart.text;
      }

      if (typedPart.type === 'refusal' && typeof typedPart.refusal === 'string') {
        return typedPart.refusal;
      }

      return '';
    })
    .join('');
};

const extractReasoningText = (item: JsonRecord): string => {
  const summary = item.summary;
  if (!Array.isArray(summary)) {
    return '';
  }

  return summary
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      const typedPart = part as JsonRecord;
      return typeof typedPart.text === 'string' ? typedPart.text : '';
    })
    .filter((text) => text.length > 0)
    .join('\n\n');
};

const getTextBlock = (
  assistant: AssistantMessage,
  index: number | null,
): Extract<AssistantMessage['content'][number], { type: 'text' }> | null => {
  if (index === null) {
    return null;
  }

  const block = assistant.content[index];
  return block?.type === 'text' ? block : null;
};

const getThinkingBlock = (
  assistant: AssistantMessage,
  index: number | null,
): Extract<AssistantMessage['content'][number], { type: 'thinking' }> | null => {
  if (index === null) {
    return null;
  }

  const block = assistant.content[index];
  return block?.type === 'thinking' ? block : null;
};

const getToolCallBlock = (
  assistant: AssistantMessage,
  index: number | null,
): Extract<AssistantMessage['content'][number], { type: 'toolCall' }> | null => {
  if (index === null) {
    return null;
  }

  const block = assistant.content[index];
  return block?.type === 'toolCall' ? block : null;
};

async function* parseSSE(response: Response): AsyncIterable<JsonRecord> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');

      while (separatorIndex !== -1) {
        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf('\n\n');

        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
          .trim();

        if (!data || data === '[DONE]') {
          continue;
        }

        try {
          yield JSON.parse(data) as JsonRecord;
        } catch {
          // ignore malformed events and continue parsing the stream
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore cancellation failures during cleanup
    }

    try {
      reader.releaseLock();
    } catch {
      // ignore release failures during cleanup
    }
  }
}

export const openAICodexTransport: ProviderTransport = {
  async *stream(model, context, options): AsyncIterable<AssistantStreamEvent> {
    const assistant = createAssistantMessage(model.provider, model.id);
    yield { type: 'start', partial: assistant };

    try {
      if (!options.apiKey) {
        throw new ProviderError('Missing API key / access token for OpenAI Codex transport.');
      }

      const accountId = extractAccountId(options.apiKey);
      const requestBody = buildOpenAICodexRequestBody(model, context, options);
      const response = await fetch(resolveCodexResponsesUrl(model.baseUrl), {
        method: 'POST',
        headers: buildSSEHeaders(
          model.headers,
          options.headers,
          accountId,
          options.apiKey,
          options.sessionId,
        ),
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new ProviderError(await parseErrorResponse(response));
      }

      let currentTextIndex: number | null = null;
      let currentThinkingIndex: number | null = null;
      let currentToolIndex: number | null = null;
      let currentToolJson = '';

      for await (const event of parseSSE(response)) {
        const type = typeof event.type === 'string' ? event.type : undefined;
        if (!type) {
          continue;
        }

        if (type === 'response.output_item.added') {
          const item = event.item;
          if (!item || typeof item !== 'object') {
            continue;
          }

          const typedItem = item as JsonRecord;
          if (typedItem.type === 'message') {
            assistant.content.push({ type: 'text', text: '' });
            currentTextIndex = assistant.content.length - 1;
            yield { type: 'text_start', contentIndex: currentTextIndex, partial: assistant };
            continue;
          }

          if (typedItem.type === 'reasoning') {
            assistant.content.push({ type: 'thinking', text: '' });
            currentThinkingIndex = assistant.content.length - 1;
            yield {
              type: 'thinking_start',
              contentIndex: currentThinkingIndex,
              partial: assistant,
            };
            continue;
          }

          if (typedItem.type === 'function_call') {
            const toolCallId =
              typeof typedItem.call_id === 'string' && typeof typedItem.id === 'string'
                ? `${typedItem.call_id}|${typedItem.id}`
                : randomUUID();
            const toolName = typeof typedItem.name === 'string' ? typedItem.name : 'unknown';
            currentToolJson = typeof typedItem.arguments === 'string' ? typedItem.arguments : '';
            assistant.content.push({
              type: 'toolCall',
              id: toolCallId,
              name: toolName,
              arguments: safeParseJson(currentToolJson || '{}'),
            });
            currentToolIndex = assistant.content.length - 1;
            yield { type: 'toolcall_start', contentIndex: currentToolIndex, partial: assistant };
          }

          continue;
        }

        if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
          const block = getTextBlock(assistant, currentTextIndex);
          if (!block || currentTextIndex === null) {
            continue;
          }

          const delta = typeof event.delta === 'string' ? event.delta : '';
          if (delta.length > 0) {
            block.text += delta;
            yield { type: 'text_delta', contentIndex: currentTextIndex, delta, partial: assistant };
          }

          continue;
        }

        if (type === 'response.reasoning_summary_text.delta') {
          const block = getThinkingBlock(assistant, currentThinkingIndex);
          if (!block || currentThinkingIndex === null) {
            continue;
          }

          const delta = typeof event.delta === 'string' ? event.delta : '';
          if (delta.length > 0) {
            block.text += delta;
            yield {
              type: 'thinking_delta',
              contentIndex: currentThinkingIndex,
              delta,
              partial: assistant,
            };
          }

          continue;
        }

        if (type === 'response.function_call_arguments.delta') {
          const block = getToolCallBlock(assistant, currentToolIndex);
          if (!block || currentToolIndex === null) {
            continue;
          }

          const delta = typeof event.delta === 'string' ? event.delta : '';
          currentToolJson += delta;
          block.arguments = safeParseJson(currentToolJson || '{}');
          yield {
            type: 'toolcall_delta',
            contentIndex: currentToolIndex,
            delta,
            partial: assistant,
          };
          continue;
        }

        if (type === 'response.output_item.done') {
          const item = event.item;
          if (!item || typeof item !== 'object') {
            continue;
          }

          const typedItem = item as JsonRecord;
          if (typedItem.type === 'message') {
            const block = getTextBlock(assistant, currentTextIndex);
            if (!block || currentTextIndex === null) {
              continue;
            }

            if (block.text.length === 0) {
              block.text = extractOutputText(typedItem);
            }
            yield {
              type: 'text_end',
              contentIndex: currentTextIndex,
              content: block.text,
              partial: assistant,
            };
            currentTextIndex = null;
            continue;
          }

          if (typedItem.type === 'reasoning') {
            const block = getThinkingBlock(assistant, currentThinkingIndex);
            if (!block || currentThinkingIndex === null) {
              continue;
            }

            if (block.text.length === 0) {
              block.text = extractReasoningText(typedItem);
            }
            yield {
              type: 'thinking_end',
              contentIndex: currentThinkingIndex,
              content: block.text,
              partial: assistant,
            };
            currentThinkingIndex = null;
            continue;
          }

          if (typedItem.type === 'function_call') {
            const block = getToolCallBlock(assistant, currentToolIndex);
            if (!block || currentToolIndex === null) {
              continue;
            }

            const finalArguments =
              typeof typedItem.arguments === 'string'
                ? typedItem.arguments
                : currentToolJson || '{}';
            block.arguments = safeParseJson(finalArguments);
            yield {
              type: 'toolcall_end',
              contentIndex: currentToolIndex,
              toolCall: block,
              partial: assistant,
            };
            currentToolIndex = null;
            currentToolJson = '';
          }

          continue;
        }

        if (type === 'response.completed') {
          const responseRecord =
            event.response && typeof event.response === 'object'
              ? (event.response as JsonRecord)
              : undefined;
          const status =
            responseRecord && typeof responseRecord.status === 'string'
              ? responseRecord.status
              : undefined;
          assistant.stopReason = mapStopReason(status);
          if (
            assistant.content.some((block) => block.type === 'toolCall') &&
            assistant.stopReason === 'stop'
          ) {
            assistant.stopReason = 'toolUse';
          }
          continue;
        }

        if (type === 'response.failed') {
          const responseRecord =
            event.response && typeof event.response === 'object'
              ? (event.response as JsonRecord)
              : undefined;
          const errorRecord =
            responseRecord?.error && typeof responseRecord.error === 'object'
              ? (responseRecord.error as JsonRecord)
              : undefined;
          const message =
            typeof errorRecord?.message === 'string'
              ? errorRecord.message
              : 'OpenAI Codex returned a failed response.';
          throw new ProviderError(message);
        }

        if (type === 'error') {
          const message =
            typeof event.message === 'string'
              ? event.message
              : 'OpenAI Codex emitted an error event.';
          throw new ProviderError(message);
        }
      }

      yield { type: 'done', reason: assistant.stopReason, message: assistant };
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
