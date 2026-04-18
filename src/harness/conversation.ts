import { randomUUID } from 'node:crypto';

import { DEFAULT_SYSTEM_PROMPT } from './config';
import { AuthError, ProviderError } from './core/errors';

import type { AssistantStreamEvent } from './agent/events';
import type { AssistantMessage, Message, UserMessage } from './agent/messages';
import type { HarnessRuntime } from './runtime';
import type { LoadedSession } from './session/manager';
import type { SessionEntry } from './session/types';
import type { ConversationMessage, SessionDetail, SessionSummary } from '../shared/anvil-api';

export interface SendConversationMessageParams {
  modelId: string;
  prompt: string;
  providerId: string;
  sessionId: string;
  signal?: AbortSignal;
}

const getMessagesFromEntries = (entries: SessionEntry[]): Message[] =>
  entries
    .filter(
      (entry): entry is Extract<SessionEntry, { type: 'message' }> => entry.type === 'message',
    )
    .map((entry) => entry.message);

const assistantText = (message: AssistantMessage): string =>
  message.content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.text;
        case 'toolCall':
          return `Tool call: ${block.name}`;
      }
    })
    .filter((text) => text.length > 0)
    .join('\n\n');

const messageText = (message: Message): string => {
  switch (message.role) {
    case 'user':
      return message.content
        .map((block) => (block.type === 'text' ? block.text : `[image:${block.mimeType}]`))
        .join('\n\n');
    case 'assistant':
      return assistantText(message);
    case 'toolResult':
      return message.content
        .map((block) => (block.type === 'text' ? block.text : `[image:${block.mimeType}]`))
        .join('\n\n');
  }
};

const toConversationMessage = (message: Message): ConversationMessage => {
  switch (message.role) {
    case 'user':
      return {
        id: message.id,
        role: 'user',
        text: messageText(message),
        timestamp: message.timestamp,
      };
    case 'assistant':
      return {
        id: message.id,
        role: 'assistant',
        stopReason: message.stopReason,
        text: messageText(message),
        timestamp: message.timestamp,
      };
    case 'toolResult':
      return {
        id: message.id,
        isError: message.isError,
        role: 'toolResult',
        text: messageText(message),
        timestamp: message.timestamp,
        toolName: message.toolName,
      };
  }
};

const deriveSessionTitle = (messages: Message[]): string => {
  const firstUserMessage = messages.find(
    (message): message is UserMessage => message.role === 'user',
  );
  if (!firstUserMessage) {
    return 'New conversation';
  }

  const text = messageText(firstUserMessage).trim();
  if (text.length === 0) {
    return 'New conversation';
  }

  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

export const toSessionSummary = (session: LoadedSession): SessionSummary => {
  const messages = getMessagesFromEntries(session.entries);

  return {
    id: session.meta.id,
    messageCount: messages.length,
    title: session.meta.title ?? deriveSessionTitle(messages),
    updatedAt: session.meta.updatedAt,
  };
};

export const toSessionDetail = (session: LoadedSession): SessionDetail => ({
  messages: getMessagesFromEntries(session.entries).map(toConversationMessage),
  session: toSessionSummary(session),
});

const getLatestAssistant = (
  current: AssistantMessage | null,
  event: AssistantStreamEvent,
): AssistantMessage | null => {
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
      return event.partial;
    case 'done':
      return event.message;
    case 'error':
      return event.error;
    default:
      return current;
  }
};

const createUserMessage = (prompt: string): UserMessage => ({
  id: randomUUID(),
  role: 'user',
  content: [{ type: 'text', text: prompt }],
  timestamp: Date.now(),
});

export const createConversationSession = async (
  runtime: HarnessRuntime,
  cwd: string,
): Promise<SessionDetail> => {
  const meta = await runtime.sessionManager.create(cwd);
  const loaded = await runtime.sessionManager.load(meta.id);
  return toSessionDetail(loaded);
};

export const loadConversationSession = async (
  runtime: HarnessRuntime,
  sessionId: string,
): Promise<SessionDetail> => {
  const loaded = await runtime.sessionManager.load(sessionId);
  return toSessionDetail(loaded);
};

export const listConversationSessions = async (
  runtime: HarnessRuntime,
  cwd?: string,
): Promise<SessionSummary[]> => {
  const sessions = await runtime.sessionManager.list(cwd);
  const loaded = await Promise.all(
    sessions.map((session) => runtime.sessionManager.load(session.id)),
  );
  return loaded.map(toSessionSummary);
};

export const sendConversationMessage = async (
  runtime: HarnessRuntime,
  params: SendConversationMessageParams,
): Promise<SessionDetail> => {
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

  const loadedSession = await runtime.sessionManager.load(params.sessionId);
  const previousMessages = getMessagesFromEntries(loadedSession.entries);
  const userMessage = createUserMessage(params.prompt);
  let assistant: AssistantMessage | null = null;

  for await (const event of provider.transport.stream(
    model,
    {
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      messages: [...previousMessages, userMessage],
      tools: [],
    },
    {
      apiKey: resolvedAuth.apiKey,
      signal: params.signal,
      sessionId: params.sessionId,
    },
  )) {
    assistant = getLatestAssistant(assistant, event);
  }

  if (!assistant) {
    throw new ProviderError('Model stream finished without an assistant message.');
  }

  await runtime.sessionManager.appendMessage(params.sessionId, userMessage);
  await runtime.sessionManager.appendMessage(params.sessionId, assistant);

  return loadConversationSession(runtime, params.sessionId);
};
