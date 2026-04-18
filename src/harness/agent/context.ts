import type { Message } from './messages';
import type { ThinkingLevel } from '../core/types';
import type { ToolDefinition } from '../tools/types';


export interface AgentContext {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
}

export interface StreamOptions {
  apiKey?: string;
  headers?: Record<string, string>;
  sessionId?: string;
  reasoning?: ThinkingLevel;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}
