import { AuthError } from '../core/errors';
import { isExpired } from '../util/time';

import type { AuthStorage } from './storage';
import type { AuthRecord, OAuthCredentials, OAuthProvider } from './types';

export interface ResolvedAuth {
  apiKey: string;
  updatedCredentials?: OAuthCredentials;
}

export interface OAuthProviderRegistry {
  get(id: string): OAuthProvider | undefined;
}

export class AuthManager {
  constructor(
    private readonly storage: AuthStorage,
    private readonly oauthProviders: OAuthProviderRegistry,
  ) {}

  async resolve(providerId: string): Promise<ResolvedAuth | null> {
    const record = await this.storage.get(providerId);
    if (!record) {
      return null;
    }

    if (record.type === 'api_key') {
      return { apiKey: record.key };
    }

    const provider = this.oauthProviders.get(record.providerId);
    if (!provider) {
      throw new AuthError(`Unknown OAuth provider: ${record.providerId}`);
    }

    let credentials = record.credentials;
    if (isExpired(credentials.expires, 30_000)) {
      credentials = await provider.refreshToken(credentials);
      await this.storage.set(providerId, this.toOAuthRecord(record, credentials));
    }

    return {
      apiKey: provider.getAccessToken(credentials),
      updatedCredentials: credentials,
    };
  }

  private toOAuthRecord(
    record: Extract<AuthRecord, { type: 'oauth' }>,
    credentials: OAuthCredentials,
  ) {
    return {
      type: 'oauth' as const,
      providerId: record.providerId,
      credentials,
    };
  }
}
