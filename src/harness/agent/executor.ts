import type { AssistantMessage, ToolResultMessage, UserMessage } from './messages';
import type { ModelSpec } from '../providers/types';


export interface AgentRunInput {
  sessionId: string;
  model: ModelSpec;
  userMessage: UserMessage;
}

export interface AgentTurnResult {
  assistant: AssistantMessage;
  toolResults: ToolResultMessage[];
}

export interface AgentExecutor {
  run(input: AgentRunInput): Promise<AgentTurnResult[]>;
}
