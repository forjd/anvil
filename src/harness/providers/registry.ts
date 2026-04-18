import type { ModelSpec, ProviderTransport } from './types';
import type { OAuthProvider } from '../auth/types';


export interface RegisteredProvider {
  id: string;
  name: string;
  transport: ProviderTransport;
  models: ModelSpec[];
  oauth?: OAuthProvider;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();

  register(provider: RegisteredProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): RegisteredProvider | undefined {
    return this.providers.get(id);
  }

  list(): RegisteredProvider[] {
    return [...this.providers.values()];
  }

  findModel(providerId: string, modelId: string): ModelSpec | undefined {
    return this.providers.get(providerId)?.models.find((model) => model.id === modelId);
  }

  getOAuthProvider(id: string): OAuthProvider | undefined {
    return this.providers.get(id)?.oauth;
  }
}
