
import { openAICodexOAuthProvider } from './auth';
import { OPENAI_CODEX_MODELS } from './models';
import { openAICodexTransport } from './transport';

import type { RegisteredProvider } from '../registry';

export const openAICodexProvider: RegisteredProvider = {
  id: 'openai-codex',
  name: 'ChatGPT Plus/Pro (Codex)',
  transport: openAICodexTransport,
  models: OPENAI_CODEX_MODELS,
  oauth: openAICodexOAuthProvider,
};
