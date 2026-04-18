import { AgentLoop } from './agent/loop';
import { AuthManager } from './auth/manager';
import { FileAuthStorage } from './auth/storage';
import { createDefaultProviderRegistry } from './providers';
import { FileSessionManager } from './session/manager';
import { createDefaultToolRegistry } from './tools';

export interface HarnessRuntime {
  authManager: AuthManager;
  authStorage: FileAuthStorage;
  agentLoop: AgentLoop;
  providerRegistry: ReturnType<typeof createDefaultProviderRegistry>;
  sessionManager: FileSessionManager;
  toolRegistry: ReturnType<typeof createDefaultToolRegistry>;
}

export const createHarnessRuntime = (): HarnessRuntime => {
  const providerRegistry = createDefaultProviderRegistry();
  const toolRegistry = createDefaultToolRegistry();
  const authStorage = new FileAuthStorage();
  const authManager = new AuthManager(authStorage, {
    get: (providerId) => providerRegistry.getOAuthProvider(providerId),
  });
  const sessionManager = new FileSessionManager();
  const agentLoop = new AgentLoop(providerRegistry, toolRegistry, sessionManager, authManager);

  return {
    authManager,
    authStorage,
    agentLoop,
    providerRegistry,
    sessionManager,
    toolRegistry,
  };
};
