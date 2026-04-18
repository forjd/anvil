export const ANVIL_IPC_CHANNELS = {
  authCancelPrompt: 'anvil:auth:cancel-prompt',
  authGetOverview: 'anvil:auth:get-overview',
  authLogin: 'anvil:auth:login',
  authLogout: 'anvil:auth:logout',
  authProgress: 'anvil:auth:progress',
  authPrompt: 'anvil:auth:prompt',
  authSubmitPrompt: 'anvil:auth:submit-prompt',
  chatCreateSession: 'anvil:chat:create-session',
  chatListSessions: 'anvil:chat:list-sessions',
  chatLoadSession: 'anvil:chat:load-session',
  chatSendMessage: 'anvil:chat:send-message',
  promptRun: 'anvil:prompt:run',
} as const;

export type AuthConnectionKind = 'api_key' | 'none' | 'oauth';
export type AuthLogLevel = 'error' | 'info' | 'success';
export type ConversationMessageRole = 'assistant' | 'toolResult' | 'user';
export type StopReason = 'aborted' | 'error' | 'length' | 'stop' | 'toolUse';

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
  workspacePath: string;
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

export interface ConversationMessage {
  id: string;
  isError?: boolean;
  role: ConversationMessageRole;
  stopReason?: StopReason;
  text: string;
  timestamp: number;
  toolName?: string;
}

export interface SessionSummary {
  id: string;
  messageCount: number;
  title: string;
  updatedAt: number;
}

export interface SessionDetail {
  messages: ConversationMessage[];
  session: SessionSummary;
}

export interface CreateSessionResult {
  detail: SessionDetail;
}

export interface SendMessageRequest {
  modelId: string;
  prompt: string;
  providerId: string;
  sessionId: string;
}

export interface SendMessageResult {
  detail?: SessionDetail;
  error?: string;
  ok: boolean;
}

export interface PromptRunRequest {
  modelId: string;
  prompt: string;
  providerId: string;
}

export interface PromptRunResult {
  error?: string;
  modelId: string;
  ok: boolean;
  prompt: string;
  providerId: string;
  responseText?: string;
  stopReason?: StopReason;
}

export interface AnvilBridge extends RuntimeSummary {
  cancelAuthPrompt(requestId: string): Promise<void>;
  createSession(): Promise<CreateSessionResult>;
  getAuthOverview(): Promise<AuthOverview>;
  listSessions(): Promise<SessionSummary[]>;
  loadSession(sessionId: string): Promise<SessionDetail>;
  login(providerId: string): Promise<AuthActionResult>;
  logout(providerId: string): Promise<AuthActionResult>;
  onAuthProgress(listener: (event: AuthProgressEvent) => void): () => void;
  onAuthPrompt(listener: (prompt: AuthPromptRequest) => void): () => void;
  runPrompt(request: PromptRunRequest): Promise<PromptRunResult>;
  sendMessage(request: SendMessageRequest): Promise<SendMessageResult>;
  submitAuthPrompt(requestId: string, value: string): Promise<void>;
}
