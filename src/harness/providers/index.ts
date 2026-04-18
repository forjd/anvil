import { openAICodexProvider } from './openai-codex';
import { ProviderRegistry } from './registry';

export const createDefaultProviderRegistry = (): ProviderRegistry => {
  const registry = new ProviderRegistry();
  registry.register(openAICodexProvider);
  return registry;
};

export * from './registry';
export * from './types';
