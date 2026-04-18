import { AuthError } from '../../core/errors';

import type { OAuthProvider } from '../../auth/types';

const notImplemented = (capability: string): Promise<never> =>
  Promise.reject(
    new AuthError(`${capability} is scaffolded but not implemented yet. Start here next.`),
  );

export const openAICodexOAuthProvider: OAuthProvider = {
  id: 'openai-codex',
  name: 'ChatGPT Plus/Pro (Codex)',

  login() {
    return notImplemented('OpenAI Codex OAuth login');
  },

  refreshToken() {
    return notImplemented('OpenAI Codex OAuth token refresh');
  },

  getAccessToken(credentials) {
    return credentials.access;
  },
};
