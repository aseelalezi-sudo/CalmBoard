import { ServiceUnavailableException } from "@nestjs/common";
import {
  createSearchRepository,
  emptySearchResults,
  MAX_SEARCH_QUERY_LENGTH,
  type DatabaseTenantContext,
  type WorkspaceSearchResults,
} from "@calmboard/database";

export const SEARCH_PROVIDER_TOKEN = Symbol("SEARCH_PROVIDER");
export { emptySearchResults, MAX_SEARCH_QUERY_LENGTH };

export interface SearchProvider {
  readonly provider: string;
  search(context: DatabaseTenantContext, query: string): Promise<WorkspaceSearchResults>;
}

export type SearchProviderFactory = () => SearchProvider;
export type SearchProviderRegistry = Readonly<Record<string, SearchProviderFactory>>;
export type SearchProviderEnvironment = { SEARCH_PROVIDER?: string };

export class PostgreSqlSearchProvider implements SearchProvider {
  readonly provider = "postgresql";

  search(context: DatabaseTenantContext, query: string) {
    return createSearchRepository(context).search(query);
  }
}

const builtInSearchProviders: SearchProviderRegistry = {
  postgresql: () => new PostgreSqlSearchProvider(),
};

export function createSearchProvider(
  environment: SearchProviderEnvironment = process.env,
  registry: SearchProviderRegistry = builtInSearchProviders,
): SearchProvider {
  const providerName = environment.SEARCH_PROVIDER?.trim().toLowerCase() || "postgresql";
  const factory = registry[providerName];
  if (!factory) {
    throw new ServiceUnavailableException(`Search provider '${providerName}' is not configured.`);
  }
  return factory();
}
