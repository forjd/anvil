export const ANVIL_IPC_CHANNELS = {
  authCancelPrompt: 'anvil:auth:cancel-prompt',
  authGetOverview: 'anvil:auth:get-overview',
  authLogin: 'anvil:auth:login',
  authLogout: 'anvil:auth:logout',
  authProgress: 'anvil:auth:progress',
  authPrompt: 'anvil:auth:prompt',
  authSubmitPrompt: 'anvil:auth:submit-prompt',
} as const;

export type AuthConnectionKind = 'api_key' | 'none' | 'oauth';
export type AuthLogLevel = 'error' | 'info' | 'success';

export interface AuthModelSummary {
  id: string;
  name: string;
}

export interface AuthProviderSummary {
  connected: boolean;
  connectionKind: AuthConnectionKind;
  hasOAuth: boolean;
  id: string;
  models: AuthModelSummary[];
  name: string;
}

export interface RuntimeSummary {
  platform: NodeJS.Platform;
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
}

export interface AuthOverview extends RuntimeSummary {
  authFilePath: string;
  providers: AuthProviderSummary[];
}

export interface AuthActionResult {
  error?: string;
  message: string;
  ok: boolean;
  overview: AuthOverview;
  providerId: string;
}

export interface AuthProgressEvent {
  instructions?: string;
  level: AuthLogLevel;
  message: string;
  providerId: string;
  timestamp: number;
  url?: string;
}

export interface AuthPromptRequest {
  message: string;
  providerId: string;
  requestId: string;
  secret?: boolean;
}

export interface AnvilBridge extends RuntimeSummary {
  cancelAuthPrompt(requestId: string): Promise<void>;
  getAuthOverview(): Promise<AuthOverview>;
  login(providerId: string): Promise<AuthActionResult>;
  logout(providerId: string): Promise<AuthActionResult>;
  onAuthProgress(listener: (event: AuthProgressEvent) => void): () => void;
  onAuthPrompt(listener: (prompt: AuthPromptRequest) => void): () => void;
  submitAuthPrompt(requestId: string, value: string): Promise<void>;
}
