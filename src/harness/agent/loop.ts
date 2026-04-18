import { randomUUID } from 'node:crypto';

import { AuthError, ProviderError } from '../core/errors';

import type { AssistantStreamEvent } from './events';
import type { AgentTurnResult } from './executor';
import type { AssistantMessage, Message, ToolCallBlock, ToolResultMessage } from './messages';
import type { AuthManager } from '../auth/manager';
import type { ProviderRegistry } from '../providers/registry';
import type { ModelSpec } from '../providers/types';
import type { SessionManager } from '../session/manager';
import type { ToolRegistry } from '../tools/registry';
import type { ToolCall } from '../tools/types';


const isToolCallBlock = (block: AssistantMessage['content'][number]): block is ToolCallBlock =>
  block.type === 'toolCall';

const buildUnknownToolResult = (toolCall: ToolCallBlock): ToolResultMessage => ({
  id: randomUUID(),
  role: 'toolResult',
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  content: [{ type: 'text', text: `Unknown tool: ${toolCall.name}` }],
  isError: true,
  timestamp: Date.now(),
});

export interface RunAgentParams {
  cwd: string;
  sessionId: string;
  model: ModelSpec;
  systemPrompt: string;
  messages: Message[];
  signal?: AbortSignal;
}

export interface RunAgentResult {
  messages: Message[];
  turns: AgentTurnResult[];
}

export class AgentLoop {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly tools: ToolRegistry,
    private readonly sessions: SessionManager,
    private readonly auth: AuthManager,
  ) {}

  async run(params: RunAgentParams): Promise<RunAgentResult> {
    let workingMessages = [...params.messages];
    const turns: AgentTurnResult[] = [];

    while (true) {
      const turn = await this.runTurn({ ...params, messages: workingMessages });
      turns.push(turn);
      workingMessages = [...workingMessages, turn.assistant, ...turn.toolResults];

      const hasToolCalls = turn.assistant.content.some(isToolCallBlock);
      if (!hasToolCalls || turn.toolResults.length === 0) {
        break;
      }
    }

    return {
      messages: workingMessages,
      turns,
    };
  }

  async runTurn(params: RunAgentParams): Promise<AgentTurnResult> {
    const provider = this.providers.get(params.model.provider);
    if (!provider) {
      throw new ProviderError(`Unknown provider: ${params.model.provider}`);
    }

    const resolvedAuth = await this.auth.resolve(params.model.provider);
    if (!resolvedAuth) {
      throw new AuthError(`No auth configured for provider: ${params.model.provider}`);
    }

    const context = {
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      tools: this.tools.list(),
    };

    let finalAssistant: AssistantMessage | null = null;

    for await (const event of provider.transport.stream(params.model, context, {
      apiKey: resolvedAuth.apiKey,
      signal: params.signal,
      sessionId: params.sessionId,
    })) {
      finalAssistant = this.updateAssistantFromEvent(event, finalAssistant);
    }

    if (!finalAssistant) {
      throw new ProviderError('Provider stream completed without an assistant message.');
    }

    await this.sessions.appendMessage(params.sessionId, finalAssistant);

    const toolResults = await this.executeToolCalls(params.cwd, finalAssistant, params.signal);
    for (const toolResult of toolResults) {
      await this.sessions.appendMessage(params.sessionId, toolResult);
    }

    return {
      assistant: finalAssistant,
      toolResults,
    };
  }

  private updateAssistantFromEvent(
    event: AssistantStreamEvent,
    current: AssistantMessage | null,
  ): AssistantMessage | null {
    switch (event.type) {
      case 'start':
        return event.partial;
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
  }

  private async executeToolCalls(
    cwd: string,
    assistant: AssistantMessage,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage[]> {
    const toolCalls = assistant.content.filter(isToolCallBlock);
    const results: ToolResultMessage[] = [];

    for (const toolCall of toolCalls) {
      const tool = this.tools.get(toolCall.name);
      if (!tool) {
        results.push(buildUnknownToolResult(toolCall));
        continue;
      }

      const output = await tool.execute(this.toToolCall(toolCall), { cwd, signal });
      results.push({
        id: randomUUID(),
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: output.content,
        isError: output.isError,
        timestamp: Date.now(),
      });
    }

    return results;
  }

  private toToolCall(toolCall: ToolCallBlock): ToolCall {
    return {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    };
  }
}
