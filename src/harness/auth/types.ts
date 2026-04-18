export interface OAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthRecordApiKey {
  type: 'api_key';
  key: string;
}

export interface AuthRecordOAuth {
  type: 'oauth';
  providerId: string;
  credentials: OAuthCredentials;
}

export type AuthRecord = AuthRecordApiKey | AuthRecordOAuth;

export interface OAuthLoginCallbacks {
  onAuth(params: { url: string; instructions?: string }): void;
  onPrompt(params: { message: string }): Promise<string>;
  onProgress?(message: string): void;
  onManualCodeInput?(): Promise<string>;
  signal?: AbortSignal;
}

export interface OAuthProvider {
  id: string;
  name: string;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getAccessToken(credentials: OAuthCredentials): string;
}
