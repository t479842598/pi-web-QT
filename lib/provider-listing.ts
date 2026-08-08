export type ProviderCredentialType = "api_key" | "oauth";

const CUSTOM_PROVIDER_SOURCES = new Set(["models_json_key", "models_json_command"]);
const OAUTH_DISPLAY_NAMES: Record<string, string> = {
  "openai-codex": "ChatGPT Plus/Pro",
  "github-copilot": "GitHub Copilot",
};

export interface ProviderListingInput {
  id: string;
  name: string;
  hasApiKeyLogin: boolean;
  hasOAuth: boolean;
  oauthName?: string;
  status: { configured: boolean; source?: string };
  credentialType?: ProviderCredentialType;
  modelCount: number;
}

export interface ApiKeyProviderListing {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  supportsOAuth: boolean;
}

export interface OAuthProviderListing {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  supportsApiKey: boolean;
}

function uniqueProviders(providers: readonly ProviderListingInput[]): ProviderListingInput[] {
  const ids = new Set<string>();
  return providers.filter((provider) => !ids.has(provider.id) && (ids.add(provider.id), true));
}

export function buildApiKeyProviderList(providers: readonly ProviderListingInput[]): ApiKeyProviderListing[] {
  return uniqueProviders(providers).flatMap((provider) => {
    // OpenCode Zen has a dedicated account/proxy pool UI; keep it out of the
    // generic provider editor and authentication picker.
    if (provider.id === "opencode" || provider.id === "opencode-go") return [];
    if (!provider.hasApiKeyLogin || (provider.status.source && CUSTOM_PROVIDER_SOURCES.has(provider.status.source))) return [];
    const configured = provider.status.configured && provider.credentialType !== "oauth";
    return [{
      id: provider.id,
      displayName: provider.name,
      configured,
      ...(configured && provider.status.source ? { source: provider.status.source } : {}),
      modelCount: provider.modelCount,
      supportsOAuth: provider.hasOAuth,
    }];
  });
}

export function buildOAuthProviderList(providers: readonly ProviderListingInput[]): OAuthProviderListing[] {
  return uniqueProviders(providers).flatMap((provider) => (provider.id === "opencode" || provider.id === "opencode-go") ? [] : provider.hasOAuth ? [{
    id: provider.id,
    name: OAUTH_DISPLAY_NAMES[provider.id] ?? provider.oauthName ?? provider.name,
    usesCallbackServer: false,
    loggedIn: provider.credentialType === "oauth",
    supportsApiKey: provider.hasApiKeyLogin,
  }] : []);
}
