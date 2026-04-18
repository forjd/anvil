import type { ToolResultContentBlock } from '../agent/messages';
import type { ID } from '../core/types';

export interface ToolExecutionContext {
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolCall {
  id: ID;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  content: ToolResultContentBlock[];
  details?: unknown;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}
