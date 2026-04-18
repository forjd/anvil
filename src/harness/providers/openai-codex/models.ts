import type { ModelSpec } from '../types';

const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';

export const OPENAI_CODEX_MODELS: ModelSpec[] = [
  {
    provider: 'openai-codex',
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    api: 'openai-codex-responses',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 272_000,
    maxTokens: 128_000,
    baseUrl: OPENAI_CODEX_BASE_URL,
  },
  {
    provider: 'openai-codex',
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    api: 'openai-codex-responses',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 272_000,
    maxTokens: 128_000,
    baseUrl: OPENAI_CODEX_BASE_URL,
  },
];
