import type { ID, TimestampMs } from '../core/types';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
  signature?: string;
}

export interface ToolCallBlock {
  type: 'toolCall';
  id: ID;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ImageBlock {
  type: 'image';
  mimeType: string;
  data: string;
}

export type UserContentBlock = TextBlock | ImageBlock;
export type AssistantContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;
export type ToolResultContentBlock = TextBlock | ImageBlock;

export interface UserMessage {
  id: ID;
  role: 'user';
  content: UserContentBlock[];
  timestamp: TimestampMs;
}

export interface AssistantMessage {
  id: ID;
  role: 'assistant';
  content: AssistantContentBlock[];
  provider: string;
  model: string;
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  errorMessage?: string;
  timestamp: TimestampMs;
}

export interface ToolResultMessage {
  id: ID;
  role: 'toolResult';
  toolCallId: ID;
  toolName: string;
  content: ToolResultContentBlock[];
  isError?: boolean;
  timestamp: TimestampMs;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
