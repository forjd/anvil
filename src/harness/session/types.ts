import type { Message } from '../agent/messages';

export interface SessionMetadata {
  id: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  model?: {
    provider: string;
    id: string;
  };
}

export type SessionEntry =
  | { type: 'meta'; meta: SessionMetadata }
  | { type: 'message'; message: Message }
  | {
      type: 'tool_execution';
      toolCallId: string;
      toolName: string;
      status: 'start' | 'end';
      timestamp: number;
      details?: unknown;
    };
