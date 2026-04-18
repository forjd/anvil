import type { AssistantMessage, ToolCallBlock } from './messages';
import type { Usage } from '../core/types';


export type AssistantStreamEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | {
      type: 'toolcall_end';
      contentIndex: number;
      toolCall: ToolCallBlock;
      partial: AssistantMessage;
    }
  | { type: 'usage'; usage: Usage; partial: AssistantMessage }
  | { type: 'done'; reason: AssistantMessage['stopReason']; message: AssistantMessage }
  | { type: 'error'; reason: 'error' | 'aborted'; error: AssistantMessage };
