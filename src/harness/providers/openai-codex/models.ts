import type { ModelSpec } from '../types';

const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api';

export const OPENAI_CODEX_MODELS: ModelSpec[] = [
  {
    provider: 'openai-codex',
    id: 'gpt-5-codex',
    name: 'GPT-5 Codex',
    api: 'openai-codex-responses',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 16_384,
    baseUrl: OPENAI_CODEX_BASE_URL,
  },
  {
    provider: 'openai-codex',
    id: 'gpt-5.4-codex',
    name: 'GPT-5.4 Codex',
    api: 'openai-codex-responses',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 128_000,
    maxTokens: 16_384,
    baseUrl: OPENAI_CODEX_BASE_URL,
  },
];
