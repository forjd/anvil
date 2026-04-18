import type { AgentContext, StreamOptions } from '../agent/context';
import type { AssistantStreamEvent } from '../agent/events';
import type { InputKind } from '../core/types';

export type ProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'custom';

export interface ModelSpec {
  provider: string;
  id: string;
  name: string;
  api: ProviderApi;
  reasoning: boolean;
  input: InputKind[];
  contextWindow: number;
  maxTokens: number;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export interface ProviderTransport {
  stream(
    model: ModelSpec,
    context: AgentContext,
    options: StreamOptions,
  ): AsyncIterable<AssistantStreamEvent>;
}
