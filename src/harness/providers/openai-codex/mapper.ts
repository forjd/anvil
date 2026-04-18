import type { AgentContext, StreamOptions } from '../../agent/context';
import type {
  AssistantMessage,
  Message,
  ToolResultMessage,
  UserMessage,
} from '../../agent/messages';
import type { ModelSpec } from '../types';

interface OpenAICodexTextInputItem {
  type: 'message';
  role: 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
}

interface OpenAICodexToolResultItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export type OpenAICodexInputItem = OpenAICodexTextInputItem | OpenAICodexToolResultItem;

export interface OpenAICodexRequestBody {
  model: string;
  stream: true;
  store: false;
  instructions: string;
  input: OpenAICodexInputItem[];
  tool_choice: 'auto';
  parallel_tool_calls: true;
  max_output_tokens?: number;
  temperature?: number;
}

const mapUserMessage = (message: UserMessage): OpenAICodexInputItem => ({
  type: 'message',
  role: 'user',
  content: message.content.map((block) =>
    block.type === 'text'
      ? { type: 'input_text', text: block.text }
      : { type: 'input_image', image_base64: block.data, mime_type: block.mimeType },
  ),
});

const mapAssistantMessage = (message: AssistantMessage): OpenAICodexInputItem => {
  const content: Array<Record<string, unknown>> = [];

  for (const block of message.content) {
    if (block.type === 'text') {
      content.push({ type: 'output_text', text: block.text });
      continue;
    }

    if (block.type === 'thinking') {
      content.push({ type: 'reasoning', text: block.text, signature: block.signature });
      continue;
    }

    content.push({
      type: 'function_call',
      call_id: block.id,
      name: block.name,
      arguments: JSON.stringify(block.arguments),
    });
  }

  return {
    type: 'message',
    role: 'assistant',
    content,
  };
};

const mapToolResultMessage = (message: ToolResultMessage): OpenAICodexToolResultItem => ({
  type: 'function_call_output',
  call_id: message.toolCallId,
  output: message.content
    .map((block) => (block.type === 'text' ? block.text : `[image:${block.mimeType}]`))
    .join('\n'),
});

export const mapMessageToOpenAICodexInput = (message: Message): OpenAICodexInputItem => {
  switch (message.role) {
    case 'user':
      return mapUserMessage(message);
    case 'assistant':
      return mapAssistantMessage(message);
    case 'toolResult':
      return mapToolResultMessage(message);
  }
};

export const buildOpenAICodexRequestBody = (
  model: ModelSpec,
  context: AgentContext,
  options: StreamOptions,
): OpenAICodexRequestBody => ({
  model: model.id,
  stream: true,
  store: false,
  instructions: context.systemPrompt,
  input: context.messages.map(mapMessageToOpenAICodexInput),
  tool_choice: 'auto',
  parallel_tool_calls: true,
  max_output_tokens: options.maxTokens,
  temperature: options.temperature,
});
