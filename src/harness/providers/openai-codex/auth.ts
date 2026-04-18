import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { AuthError } from '../../core/errors';

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProvider } from '../../auth/types';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
const SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const OAUTH_ORIGINATOR = 'anvil';

interface AuthorizationFlow {
  state: string;
  url: string;
  verifier: string;
}

interface CallbackServerHandle {
  cancelWait(): void;
  close(): Promise<void>;
  waitForCode(): Promise<{ code: string } | null>;
}

interface ParsedAuthorizationInput {
  code?: string;
  state?: string;
}

interface TokenResponse {
  access: string;
  expires: number;
  refresh: string;
}

const base64UrlEncode = (value: Uint8Array | Buffer): string =>
  Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
};

const generatePKCE = (): { challenge: string; verifier: string } => {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());

  return { challenge, verifier };
};

const createState = (): string => randomBytes(16).toString('hex');

const closeServer = async (server: Server): Promise<void> =>
  new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });

const oauthSuccessHtml = (message: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Anvil authentication</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090b0f;
        color: #f5f7ff;
        font-family: Inter, system-ui, sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 2rem;
        border-radius: 1.25rem;
        border: 1px solid rgba(124, 136, 255, 0.2);
        background: rgba(20, 24, 33, 0.92);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #c5cae6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Authentication complete</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

const oauthErrorHtml = (message: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Anvil authentication</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090b0f;
        color: #f5f7ff;
        font-family: Inter, system-ui, sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 2rem;
        border-radius: 1.25rem;
        border: 1px solid rgba(239, 68, 68, 0.22);
        background: rgba(36, 15, 18, 0.9);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #fecaca;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Authentication failed</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

const parseAuthorizationInput = (input: string): ParsedAuthorizationInput => {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    // ignore parse failure and fall through to other formats
  }

  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }

  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
    };
  }

  return { code: value };
};

const getAccountId = (accessToken: string): string => {
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new AuthError('Failed to extract account id from access token.');
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const auth = payload[JWT_CLAIM_PATH];

    if (!auth || typeof auth !== 'object') {
      throw new AuthError('OpenAI token payload did not include ChatGPT account metadata.');
    }

    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new AuthError('OpenAI token payload did not include a ChatGPT account id.');
    }

    return accountId;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError('Failed to decode OpenAI access token.', { cause: error });
  }
};

const exchangeAuthorizationCode = async (
  code: string,
  verifier: string,
): Promise<TokenResponse> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AuthError(
      `OpenAI token exchange failed (${response.status}): ${body || response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new AuthError('OpenAI token exchange returned an invalid response.');
  }

  return {
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
    refresh: json.refresh_token,
  };
};

const refreshAccessToken = async (refreshToken: string): Promise<TokenResponse> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AuthError(
      `OpenAI token refresh failed (${response.status}): ${body || response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new AuthError('OpenAI token refresh returned an invalid response.');
  }

  return {
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
    refresh: json.refresh_token,
  };
};

const createAuthorizationFlow = (): AuthorizationFlow => {
  const { challenge, verifier } = generatePKCE();
  const state = createState();
  const url = new URL(AUTHORIZE_URL);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', OAUTH_ORIGINATOR);

  return { state, url: url.toString(), verifier };
};

const startLocalOAuthServer = async (
  expectedState: string,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<CallbackServerHandle> => {
  let settleWait: ((value: { code: string } | null) => void) | null = null;
  const waitForCode = new Promise<{ code: string } | null>((resolve) => {
    settleWait = resolve;
  });

  const settle = (value: { code: string } | null): void => {
    if (!settleWait) {
      return;
    }

    const resolver = settleWait;
    settleWait = null;
    resolver(value);
  };

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '', `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        response.statusCode = 404;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(oauthErrorHtml('Callback route not found.'));
        return;
      }

      if (url.searchParams.get('state') !== expectedState) {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(oauthErrorHtml('State mismatch.'));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(oauthErrorHtml('Missing authorization code.'));
        return;
      }

      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        oauthSuccessHtml('OpenAI authentication completed. You can return to Anvil now.'),
      );
      settle({ code });
    } catch {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(oauthErrorHtml('Internal error while processing the OAuth callback.'));
    }
  });

  return new Promise<CallbackServerHandle>((resolve) => {
    const handleAbort = (): void => {
      settle(null);
      void closeServer(server);
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      onProgress?.(`Listening for the OAuth callback on ${REDIRECT_URI}.`);
      resolve({
        cancelWait() {
          settle(null);
        },
        async close() {
          signal?.removeEventListener('abort', handleAbort);
          await closeServer(server);
        },
        waitForCode() {
          return waitForCode;
        },
      });
    });

    server.on('error', (error) => {
      signal?.removeEventListener('abort', handleAbort);
      onProgress?.(
        `Could not start the local callback server (${error instanceof Error ? error.message : String(error)}). Falling back to manual paste.`,
      );

      settle(null);
      resolve({
        cancelWait() {
          // no-op fallback
        },
        async close() {
          try {
            await closeServer(server);
          } catch {
            // ignore cleanup failures for the fallback handle
          }
        },
        waitForCode() {
          return Promise.resolve(null);
        },
      });
    });
  });
};

const parseManualAuthorizationInput = (input: string, expectedState: string): string => {
  const parsed = parseAuthorizationInput(input);

  if (parsed.state && parsed.state !== expectedState) {
    throw new AuthError('State mismatch. Please retry the login flow.');
  }

  if (!parsed.code) {
    throw new AuthError('Missing authorization code.');
  }

  return parsed.code;
};

const throwIfPresent = (error: Error | undefined): void => {
  if (error) {
    throw error;
  }
};

export const loginOpenAICodex = async (
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> => {
  const { state, url, verifier } = createAuthorizationFlow();
  const onProgress = callbacks.onProgress
    ? (message: string): void => {
        callbacks.onProgress?.(message);
      }
    : undefined;
  const server = await startLocalOAuthServer(state, callbacks.signal, onProgress);

  callbacks.onAuth({
    instructions:
      'A browser window should open. Complete login there. If the redirect does not complete automatically, paste the full callback URL or authorization code into Anvil.',
    url,
  });

  let code: string | undefined;

  try {
    if (callbacks.onManualCodeInput) {
      let manualError: Error | undefined;
      let manualInput: string | undefined;

      const manualPromise = callbacks
        .onManualCodeInput()
        .then((value) => {
          manualInput = value;
          server.cancelWait();
        })
        .catch((error: unknown) => {
          manualError = error instanceof Error ? error : new Error(String(error));
          server.cancelWait();
        });

      const callbackResult = await server.waitForCode();
      throwIfPresent(manualError);

      if (callbackResult?.code) {
        code = callbackResult.code;
      } else if (manualInput) {
        code = parseManualAuthorizationInput(manualInput, state);
      }

      if (!code) {
        await manualPromise;

        throwIfPresent(manualError);

        if (manualInput) {
          code = parseManualAuthorizationInput(manualInput, state);
        }
      }
    } else {
      const callbackResult = await server.waitForCode();
      if (callbackResult?.code) {
        code = callbackResult.code;
      }
    }

    if (!code) {
      const input = await callbacks.onPrompt({
        message: 'Paste the authorization code or full redirect URL:',
      });
      code = parseManualAuthorizationInput(input, state);
    }

    callbacks.onProgress?.('Exchanging authorization code for an access token...');
    const tokenResponse = await exchangeAuthorizationCode(code, verifier);
    const accountId = getAccountId(tokenResponse.access);

    callbacks.onProgress?.('OpenAI login completed. Local credentials are ready to use.');

    return {
      access: tokenResponse.access,
      accountId,
      expires: tokenResponse.expires,
      refresh: tokenResponse.refresh,
    };
  } finally {
    await server.close();
  }
};

export const refreshOpenAICodexToken = async (
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> => {
  const tokenResponse = await refreshAccessToken(credentials.refresh);
  const accountId = getAccountId(tokenResponse.access);

  return {
    access: tokenResponse.access,
    accountId,
    expires: tokenResponse.expires,
    refresh: tokenResponse.refresh,
    metadata: credentials.metadata,
  };
};

export const openAICodexOAuthProvider: OAuthProvider = {
  id: 'openai-codex',
  name: 'ChatGPT Plus/Pro (Codex)',

  login(callbacks) {
    return loginOpenAICodex(callbacks);
  },

  refreshToken(credentials) {
    return refreshOpenAICodexToken(credentials);
  },

  getAccessToken(credentials) {
    return credentials.access;
  },
};
